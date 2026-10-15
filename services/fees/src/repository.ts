import { BadRequestException, ConflictException, Injectable, OnModuleDestroy } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { domainEventTypes, formatFeeMoney, parseFeeImport, type FeeImport, type FeeQuery, type FeeReport, type FeeStudent } from '@schoolconnect/contracts';
import { invoiceKey, planFeeImport, type Collection, type Invoice } from './ledger';
import { PgOutbox, eventingStatus, eventingHealth } from '@schoolconnect/eventing';

export type ImportContext = { schoolId: string; actorUserId: string; actorMembershipId: string; correlationId: string; students: FeeStudent[]; data: FeeImport };
type Database = Pick<PoolClient, 'query'>;

@Injectable()
export class FeesRepository implements OnModuleDestroy {
  private readonly pool = new Pool({ connectionString: process.env.FEES_DATABASE_URL ?? 'postgresql://schoolconnect:schoolconnect@localhost:5432/schoolconnect_fees', max: Number(process.env.FEES_DB_POOL_MAX ?? 4), connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS ?? 3000), statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 5000) });
  async health() { await this.pool.query('SELECT 1'); return { status:eventingHealth('publisher:fees'), service: 'fees' }; }
  private async plan(db: Database, context: ImportContext) {
    const data = parseFeeImport(context.data);
    const students = context.students;
    if (!Array.isArray(students) || students.length > 400) throw new BadRequestException('Invalid student resolution.');
    const ids = students.map((student) => student.id);
    const invoices = await db.query<Invoice>(`SELECT id,student_id AS "studentId",admission_number AS "admissionNumber",student_name AS "studentName",fee_reference AS "feeReference",academic_year AS "academicYear",to_char(due_date,'YYYY-MM-DD') AS "dueDate",amount_minor::text AS "amountMinor",currency,description FROM fee_invoices WHERE school_id=$1 AND student_id=ANY($2::uuid[])`, [context.schoolId, ids]);
    const receipts = await db.query<Collection>(`SELECT c.id,c.invoice_id AS "invoiceId",c.collection_reference AS "collectionReference",to_char(c.collection_date,'YYYY-MM-DD') AS "collectionDate",c.amount_minor::text AS "amountMinor" FROM fee_collections c JOIN fee_invoices i ON i.school_id=c.school_id AND i.id=c.invoice_id WHERE c.school_id=$1 AND (i.student_id=ANY($2::uuid[]) OR c.collection_reference=ANY($3::text[]))`, [context.schoolId, ids, data.collections.map((row) => row.collectionReference)]);
    const revision = await db.query<{ revision: number }>('SELECT revision FROM fee_ledger_state WHERE school_id=$1', [context.schoolId]);
    return { plan: planFeeImport(data, students, invoices.rows, receipts.rows, revision.rows[0]?.revision ?? 0), before: { invoices: invoices.rows, collections: receipts.rows }, data };
  }
  async preview(context: ImportContext) {
    const client = await this.pool.connect();
    try { await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); const result = await this.plan(client, context); await client.query('COMMIT'); return result.plan.preview; }
    catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async commit(context: ImportContext & { batchId: string; revision: number }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Serializes only this school's ledger; other schools remain independent.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,103))', [context.schoolId]);
      const data = parseFeeImport(context.data), payloadHash = createHash('sha256').update(JSON.stringify(data)).digest('hex');
      const prior = await client.query<{ payload_hash: string; actor_user_id: string; result: unknown }>('SELECT payload_hash,actor_user_id,result FROM fee_import_batches WHERE school_id=$1 AND batch_id=$2', [context.schoolId, context.batchId]);
      if (prior.rows[0]) {
        if (prior.rows[0].payload_hash !== payloadHash || prior.rows[0].actor_user_id !== context.actorUserId) throw new ConflictException({ code: 'FEE_BATCH_KEY_REUSED' });
        await client.query('COMMIT'); return prior.rows[0].result;
      }
      const { plan, before } = await this.plan(client, { ...context, data });
      if (plan.preview.revision !== context.revision) throw new ConflictException({ code: 'FEE_LEDGER_CHANGED_REVIEW_AGAIN' });
      if (!plan.preview.valid) throw new BadRequestException({ code: 'FEE_IMPORT_INVALID', issues: plan.preview.issues });
      const ids = new Map(before.invoices.map((invoice) => [invoiceKey(invoice.studentId, invoice.feeReference), invoice.id]));
      const invoiceChanges = plan.invoices.filter((row) => row.action !== 'UNCHANGED').map((row) => ({ student_id:row.studentId,admission_number:row.admissionNumber,student_name:row.studentName,fee_reference:row.feeReference,academic_year:row.academicYear,due_date:row.dueDate,amount_minor:row.amountMinor,currency:row.currency,description:row.description }));
      if (invoiceChanges.length) {
        const saved = await client.query<{ id:string; studentId:string; feeReference:string }>(`INSERT INTO fee_invoices(school_id,student_id,admission_number,student_name,fee_reference,academic_year,due_date,amount_minor,currency,description) SELECT $1,x.student_id,x.admission_number,x.student_name,x.fee_reference,x.academic_year,x.due_date,x.amount_minor,x.currency,x.description FROM jsonb_to_recordset($2::jsonb) AS x(student_id uuid,admission_number text,student_name text,fee_reference text,academic_year text,due_date date,amount_minor bigint,currency text,description text) ON CONFLICT(school_id,student_id,fee_reference) DO UPDATE SET admission_number=excluded.admission_number,student_name=excluded.student_name,academic_year=excluded.academic_year,due_date=excluded.due_date,amount_minor=excluded.amount_minor,currency=excluded.currency,description=excluded.description,updated_at=now() RETURNING id,student_id AS "studentId",fee_reference AS "feeReference"`, [context.schoolId,JSON.stringify(invoiceChanges)]);
        for (const row of saved.rows) ids.set(invoiceKey(row.studentId,row.feeReference),row.id);
      }
      const collectionChanges = plan.collections.filter((row) => row.action !== 'UNCHANGED').map((row) => ({ invoice_id:ids.get(row.invoiceKey),collection_reference:row.collectionReference,collection_date:row.collectionDate,amount_minor:row.amountMinor }));
      if (collectionChanges.length) await client.query(`INSERT INTO fee_collections(school_id,invoice_id,collection_reference,collection_date,amount_minor) SELECT $1,x.invoice_id,x.collection_reference,x.collection_date,x.amount_minor FROM jsonb_to_recordset($2::jsonb) AS x(invoice_id uuid,collection_reference text,collection_date date,amount_minor bigint) ON CONFLICT(school_id,collection_reference) DO UPDATE SET collection_date=excluded.collection_date,amount_minor=excluded.amount_minor,updated_at=now()`, [context.schoolId,JSON.stringify(collectionChanges)]);
      const result = { ...plan.preview.counts, revision: context.revision + 1, batchId: context.batchId };
      await client.query('INSERT INTO fee_ledger_state(school_id,revision) VALUES($1,1) ON CONFLICT(school_id) DO UPDATE SET revision=fee_ledger_state.revision+1', [context.schoolId]);
      await client.query('INSERT INTO fee_import_batches(school_id,batch_id,actor_user_id,payload_hash,result,changes) VALUES($1,$2,$3,$4,$5,$6)', [context.schoolId,context.batchId,context.actorUserId,payloadHash,result,{ before, invoices: plan.invoices, collections: plan.collections }]);
      // Durable business change, detailed local audit, and Kafka handoff commit together.
      await client.query('INSERT INTO outbox_events(event_type,aggregate_id,payload) VALUES($1,$2,$3)', [domainEventTypes.feesImported,context.batchId,{ schoolId:context.schoolId,actorUserId:context.actorUserId,actorMembershipId:context.actorMembershipId,correlationId:context.correlationId,...result }]);
      await client.query('COMMIT'); return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async report(schoolId: string, query: FeeQuery, studentIds: string[] | null): Promise<FeeReport> {
    const parameters = [schoolId,query.fromDate,query.toDateExclusive,studentIds];
    const cte = query.metric === 'COLLECTED'
      ? `SELECT i.student_id,i.admission_number,i.student_name,i.fee_reference,c.collection_reference,to_char(c.collection_date,'YYYY-MM-DD') AS date,i.currency,c.amount_minor AS amount FROM fee_collections c JOIN fee_invoices i ON i.school_id=c.school_id AND i.id=c.invoice_id WHERE i.school_id=$1 AND ($2::date IS NULL OR c.collection_date >= $2::date) AND ($3::date IS NULL OR c.collection_date < $3::date) AND ($4::uuid[] IS NULL OR i.student_id=ANY($4::uuid[]))`
      : `SELECT i.student_id,i.admission_number,i.student_name,i.fee_reference,NULL::text AS collection_reference,to_char(i.due_date,'YYYY-MM-DD') AS date,i.currency,i.amount_minor-COALESCE((SELECT SUM(c.amount_minor) FROM fee_collections c WHERE c.school_id=i.school_id AND c.invoice_id=i.id),0) AS amount FROM fee_invoices i WHERE i.school_id=$1 AND ($2::date IS NULL OR i.due_date >= $2::date) AND ($3::date IS NULL OR i.due_date < $3::date) AND ($4::uuid[] IS NULL OR i.student_id=ANY($4::uuid[]))`;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const totals = await client.query<{ currency: string; amount: string }>(`WITH records AS (${cte}) SELECT currency,SUM(amount)::text AS amount FROM records WHERE amount>0 GROUP BY currency ORDER BY currency`, parameters);
      const counts = await client.query<{ students: number; records: number }>(`WITH records AS (${cte}) SELECT COUNT(DISTINCT student_id)::int AS students,COUNT(*)::int AS records FROM records WHERE amount>0`, parameters);
      const details = await client.query<{ admissionNumber: string; studentName: string; feeReference: string; collectionReference?: string; date: string; currency: string; amount: string }>(`WITH records AS (${cte}) SELECT admission_number AS "admissionNumber",student_name AS "studentName",fee_reference AS "feeReference",collection_reference AS "collectionReference",date,currency,amount::text FROM records WHERE amount>0 ORDER BY date,admission_number,fee_reference,collection_reference LIMIT 200`, parameters);
      await client.query('COMMIT');
      return { query,studentCount:counts.rows[0].students,recordCount:counts.rows[0].records,currencies:totals.rows.map((row) => ({ currency:row.currency,amountMinor:row.amount,amount:formatFeeMoney(row.amount,row.currency) })),records:details.rows.map((row) => ({ ...row,amount:formatFeeMoney(row.amount,row.currency) })),truncated:counts.rows[0].records>200 };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async claimOutbox(limit: number) { return new PgOutbox(this.pool).claim(limit); }
  async renewOutbox(id: string, token: string) { return new PgOutbox(this.pool).renew(id,token); }
  async completeOutbox(id: string, success: boolean, token?: string, errorCode?: string) { return new PgOutbox(this.pool).complete(id,success,token,errorCode); }
  async eventingDiagnostics() { return { runtime:eventingStatus('publisher:fees'),outbox:await new PgOutbox(this.pool).status() }; }

  async onModuleDestroy() { await this.pool.end(); }
}
