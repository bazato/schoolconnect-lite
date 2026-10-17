import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
export interface ScannerBudget {
  status():Promise<{remaining:number;checkedAt:Date|null;fingerprint:string|null}>;
  acquire():Promise<string>;
  release(token:string):Promise<void>;
  verified(fingerprint:string):Promise<void>;
  close():Promise<void>;
}
export class PgScannerBudget implements ScannerBudget {
  constructor(private readonly pool=new Pool({connectionString:process.env.FILE_DATABASE_URL,max:1,connectionTimeoutMillis:3000,statement_timeout:5000}),private readonly limit=Number(process.env.FILE_SCANNER_REQUEST_LIMIT??550)){
    if(!Number.isSafeInteger(limit)||limit<1||limit>550)throw Error('FILE_SCANNER_BUDGET_INVALID');
  }
  async status(){
    const result=await this.pool.query<{used:string;health_checked_at:Date|null;health_key_fingerprint:string|null}>(`SELECT (SELECT count(*) FROM scanner_requests WHERE provider='cloudmersive' AND requested_at>now()-interval '31 days')::text AS used,health_checked_at,health_key_fingerprint FROM scanner_provider_state WHERE provider='cloudmersive'`);
    const row=result.rows[0];if(!row)throw Error('FILE_SCANNER_BUDGET_UNAVAILABLE');
    return {remaining:Math.max(0,this.limit-Number(row.used)),checkedAt:row.health_checked_at,fingerprint:row.health_key_fingerprint};
  }
  async acquire(){
    const client=await this.pool.connect(),token=randomUUID();
    try{
      await client.query('BEGIN');await client.query(`SELECT provider FROM scanner_provider_state WHERE provider='cloudmersive' FOR UPDATE`);
      const state=await client.query<{busy:boolean;used:string}>(`SELECT (coalesce(lease_until>now(),false) OR coalesce(last_request_at>now()-interval '1100 milliseconds',false)) AS busy,(SELECT count(*) FROM scanner_requests WHERE provider='cloudmersive' AND requested_at>now()-interval '31 days')::text AS used FROM scanner_provider_state WHERE provider='cloudmersive'`);
      if(!state.rows[0])throw Error('FILE_SCANNER_BUDGET_UNAVAILABLE');
      if(Number(state.rows[0].used)>=this.limit)throw Error('FILE_SCANNER_QUOTA_EXCEEDED');
      if(state.rows[0].busy)throw Error('FILE_SCANNER_BUSY');
      await client.query(`UPDATE scanner_provider_state SET lease_token=$1,lease_until=now()+interval '90 seconds',last_request_at=now() WHERE provider='cloudmersive'`,[token]);
      await client.query(`INSERT INTO scanner_requests(id,provider) VALUES($1,'cloudmersive')`,[token]);await client.query('COMMIT');return token;
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  async release(token:string){await this.pool.query(`UPDATE scanner_provider_state SET lease_token=NULL,lease_until=NULL WHERE provider='cloudmersive' AND lease_token=$1`,[token]);}
  async verified(fingerprint:string){await this.pool.query(`UPDATE scanner_provider_state SET health_checked_at=now(),health_key_fingerprint=$1 WHERE provider='cloudmersive'`,[fingerprint]);}
  async close(){await this.pool.end();}
}
