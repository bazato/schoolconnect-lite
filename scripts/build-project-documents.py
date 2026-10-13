"""Build verified PDF documentation from checked-in Markdown and SQL migrations.

Requires the bundled reportlab/pypdf/Pillow runtime. No service credentials or
database contents are read. The dictionary is a mechanical migration extraction.
"""
from pathlib import Path
import re
from hashlib import sha1
from html import escape
from collections import OrderedDict
from reportlab.pdfgen import canvas
from reportlab.platypus import (
    BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, PageBreak,
    Table, TableStyle, KeepTogether, Flowable,
)
from reportlab.platypus.tableofcontents import TableOfContents
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.utils import simpleSplit
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.pagesizes import letter
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output' / 'pdf'
OUT.mkdir(parents=True, exist_ok=True)
FONTDIR = Path('C:/Windows/Fonts')
for name, file in [('DocSans', 'arial.ttf'), ('DocBold', 'arialbd.ttf'), ('DocItalic', 'ariali.ttf')]:
    pdfmetrics.registerFont(TTFont(name, str(FONTDIR / file)))
pdfmetrics.registerFontFamily('DocSans', normal='DocSans', bold='DocBold', italic='DocItalic', boldItalic='DocBold')
INK = colors.HexColor('#171923')
PURPLE = colors.HexColor('#5E24AA')
MUTED = colors.HexColor('#525866')
W = 504
STYLES = getSampleStyleSheet()
STYLES.add(ParagraphStyle('BodyDoc', fontName='DocSans', fontSize=11, leading=15.3, textColor=INK, spaceAfter=8))
STYLES.add(ParagraphStyle('H1Doc', fontName='DocBold', fontSize=16, leading=20, textColor=INK, spaceBefore=16, spaceAfter=10, keepWithNext=True))
STYLES.add(ParagraphStyle('H2Doc', fontName='DocBold', fontSize=12, leading=16, textColor=INK, spaceBefore=13, spaceAfter=7, keepWithNext=True))
STYLES.add(ParagraphStyle('TableDoc', fontName='DocSans', fontSize=9.4, leading=12.2, textColor=INK, splitLongWords=True))
STYLES.add(ParagraphStyle('TableHeadDoc', parent=STYLES['TableDoc'], fontName='DocBold'))
STYLES.add(ParagraphStyle('CoverDoc', fontName='DocBold', fontSize=30, leading=36, textColor=INK, spaceAfter=18))
STYLES.add(ParagraphStyle('SmallDoc', fontName='DocSans', fontSize=9, leading=12, textColor=MUTED, spaceAfter=8))
STYLES.add(ParagraphStyle('BulletDoc', parent=STYLES['BodyDoc'], leftIndent=16, firstLineIndent=-12, spaceAfter=5))
STYLES.add(ParagraphStyle('IdentifierDoc', parent=STYLES['BodyDoc'], keepWithNext=True))
APPENDIX_INTRO = ('The following appendix is generated from migration CREATE TABLE statements plus subsequent added columns. '
                  'It lists declared columns and types, not a full executable DDL or a live database introspection. '
                  'Relationship and key explanations above include important later indexes and policy implications. '
                  'Seeds are test fixtures, not production data. Regenerate these documents after changes to public routes, '
                  'migrations, event semantics or production configuration.')

def clean(text):
    return text.replace('\u2011', '-').replace('\u2013', '-').replace('\u2014', '-').replace('\u2019', "'").replace('\u2018', "'").replace('\u201c', '"').replace('\u201d', '"')

def rich(text):
    text = clean(text)
    parts = re.split(r'(`[^`]+`|\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*)', text)
    values = []
    for part in parts:
        if part.startswith('`'):
            values.append('<font size="9.6">' + escape(part[1:-1]) + '</font>')
        elif part.startswith('**'):
            values.append('<b>' + escape(part[2:-2]) + '</b>')
        elif re.match(r'^\[[^\]]+\]\(', part):
            label, url = re.match(r'^\[([^\]]+)\]\(([^)]+)\)$', part).groups()
            if url.startswith('https://'):
                values.append('<link href="' + escape(url, quote=True) + '" color="#5E24AA">' + escape(label) + '</link>')
            else:
                values.append(escape(label))
        else:
            values.append(escape(part))
    return ''.join(values)

def sql_parts(s):
    parts, depth, start, quote = [], 0, 0, False
    i = 0
    while i < len(s):
        char = s[i]
        if char == "'":
            if quote and i+1 < len(s) and s[i+1] == "'":
                i += 2
                continue
            quote = not quote
        if not quote:
            if char in '([':
                depth += 1
            elif char in ')]':
                depth -= 1
            elif char == ',' and depth == 0:
                parts.append(s[start:i].strip())
                start = i+1
        i += 1
    parts.append(s[start:].strip())
    return parts

def dictionary():
    databases = OrderedDict()
    for file in sorted((ROOT / 'infra/postgres/init').glob('*.sql')):
        sql = file.read_text(encoding='utf-8')
        segments = re.split(r'\\connect\s+(schoolconnect_\w+)', sql)
        for j in range(1, len(segments), 2):
            database, source = segments[j:j+2]
            group = databases.setdefault(database, OrderedDict())
            for match in re.finditer(r'CREATE TABLE(?: IF NOT EXISTS)?\s+(\w+)\s*\(', source, re.I):
                table = match.group(1)
                start, pos, depth, quote = match.end(), match.end(), 1, False
                while pos < len(source) and depth:
                    char = source[pos]
                    if char == "'":
                        quote = not quote
                    if not quote:
                        depth += (char == '(') - (char == ')')
                    pos += 1
                columns = group.setdefault(table, OrderedDict())
                for clause in sql_parts(source[start:pos-1]):
                    found = re.match(r'^(\w+)\s+(.+)$', clause, re.S)
                    if not found or found.group(1).upper() in ['PRIMARY','UNIQUE','CHECK','FOREIGN','CONSTRAINT']:
                        continue
                    name, spec = found.groups()
                    columns[name] = (' '.join(spec.split()), file.name)
            for match in re.finditer(r'ALTER TABLE\s+(\w+)\s+ADD COLUMN(?: IF NOT EXISTS)?\s+(\w+)\s+([^;]+);', source, re.I):
                table, name, spec = match.groups()
                group[table][name] = (' '.join(spec.split()), file.name)
            for match in re.finditer(r'ALTER TABLE\s+(\w+)\s+ALTER COLUMN\s+(\w+)\s+TYPE\s+(\S+)', source, re.I):
                table, name, newtype = match.groups()
                old, _ = group[table][name]
                group[table][name] = (re.sub(r'^\S+', newtype, old), file.name)
    count = sum(len(tables) for tables in databases.values())
    assert count == 53, f'Unexpected application table count {count}'
    lines = []
    for database, tables in databases.items():
        lines.extend(['', '### ' + database.replace('_', ' '), '', f'Owned application tables: {len(tables)}. Database identifier: `{database}`.', ''])
        for table, columns in tables.items():
            lines.extend(['', '#### ' + table.replace('_', ' '), '', f'Table identifier: `{table}`.', '', '| Column | Declared type | Column constraint or default |', '| --- | --- | --- |'])
            for col, (spec, file) in columns.items():
                pieces = re.split(r'\s+(?=PRIMARY KEY|NOT NULL|NULL\b|UNIQUE\b|REFERENCES\b|DEFAULT\b|CHECK\b)', spec, maxsplit=1)
                typ, detail = pieces[0], pieces[1] if len(pieces) > 1 else 'Nullable; no column default declared'
                # Long enum declarations belong in executable SQL, not a tiny PDF cell.
                detail = re.sub(r'CHECK\s*\(.*', 'CHECK constraint; see owning migration', detail)
                lines.append(f'| `{col}` | {typ} | {detail} |')
    return '\n'.join(lines)

class Sequence(Flowable):
    def __init__(self, source):
        super().__init__()
        self.actors, self.messages = OrderedDict(), []
        for line in source.splitlines():
            line = line.strip()
            p = re.match(r'participant (\w+) as (.+)', line)
            m = re.match(r'(\w+)(-->>|->>)(\w+):\s*(.+)', line)
            if p:
                self.actors[p.group(1)] = p.group(2)
            elif m:
                self.messages.append(m.groups())
        self.width = W
        self.xs = {key: 42 + n*(W-84)/max(1,len(self.actors)-1) for n,key in enumerate(self.actors)}
        self.layout = []
        for number,(src, arrow, dst, label) in enumerate(self.messages,1):
            x1,x2 = self.xs[src],self.xs[dst]
            maxwidth = min(260, max(142, abs(x2-x1)-10))
            cx = min(W-maxwidth/2-4,max(maxwidth/2+4,(x1+x2)/2 if src != dst else x1))
            text = f'{number}. {label}'
            lines = simpleSplit(text,'DocSans',9,maxwidth)
            spacing = 36 if src == dst else 21
            self.layout.append((src,arrow,dst,lines,cx,maxwidth, max(38,len(lines)*11+spacing)))
        self.height = 50 + sum(m[-1] for m in self.layout)
        if self.height > 615:
            raise ValueError(f'Sequence too tall: {self.height}')
    def wrap(self, aw, ah):
        return self.width,self.height
    def draw(self):
        c = self.canv
        for key,label in self.actors.items():
            x=self.xs[key]
            c.setStrokeColor(colors.HexColor('#C9CBD3'))
            c.setDash(2,3)
            c.line(x,10,x,self.height-35)
            c.setDash()
            c.setFillColor(INK)
            c.setFont('DocBold',9)
            for i,line in enumerate(simpleSplit(label,'DocBold',9,79)):
                c.drawCentredString(x,self.height-12-i*11,line)
        y = self.height-40
        for src,arrow,dst,lines,cx,maxwidth,step in self.layout:
            x1,x2 = self.xs[src],self.xs[dst]
            c.setFillColor(colors.white)
            c.rect(cx-maxwidth/2-2,y-len(lines)*11+1,maxwidth+4,len(lines)*11,fill=1,stroke=0)
            c.setFillColor(INK)
            c.setFont('DocSans',9)
            for index,line in enumerate(lines):
                c.drawCentredString(cx,y-index*11,line)
            ay = y-len(lines)*11-3
            c.setStrokeColor(MUTED if arrow=='-->>' else PURPLE)
            c.setLineWidth(.8)
            c.setDash(3,2) if arrow=='-->>' else c.setDash()
            if src==dst:
                shift = 19 if x1 < W-60 else -19
                c.lines([(x1,ay,x1+shift,ay),(x1+shift,ay,x1+shift,ay-9),(x1+shift,ay-9,x1,ay-9)])
                direction = -1 if shift>0 else 1
                tipy=ay-9
            else:
                c.line(x1,ay,x2,ay)
                direction=1 if x2>x1 else -1
                tipy=ay
            c.setDash()
            c.lines([(x2,tipy,x2-5*direction,tipy+2.8),(x2,tipy,x2-5*direction,tipy-2.8)])
            y-=step

class Document(BaseDocTemplate):
    def __init__(self,path,label):
        super().__init__(str(path),pagesize=letter,leftMargin=54,rightMargin=54,topMargin=49,bottomMargin=48,
                         title='Nexqon School App '+label, author='Nexqon project documentation',allowSplitting=True)
        self.label,self.hcounter=label,0
        self.addPageTemplates(PageTemplate(id='regular',frames=Frame(54,48,W,695,leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0),onPage=self.page))
    def page(self,c,doc):
        c.saveState()
        c.setFillColor(MUTED)
        c.setFont('DocSans',8.3)
        if doc.page>1:
            c.drawString(54,764,'NEXQON SCHOOL APP  /  '+self.label.upper())
        c.drawString(54,27,'13 October 2026  |  Controlled trial reference')
        c.drawRightString(558,27,str(doc.page))
        c.restoreState()
    def afterFlowable(self,f):
        if isinstance(f,Paragraph) and f.style.name=='H1Doc' and f.getPlainText() != 'Contents':
            text = f.getPlainText()
            key='section-'+sha1(text.encode()).hexdigest()[:12]
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(text,key,0)
            self.notify('TOCEntry',(0,text,self.page,key))

def table(rows):
    n = len(rows[0])
    if n==2:
        widths=[165,339]
    elif n==3:
        widths=[118,133,253]
        if rows[0][0]=='API area':
            widths=[88,242,174]
        elif rows[0][0]=='Setting':
            widths=[194,94,216]
    else:
        widths=[80,55,158,211]
    p = [[Paragraph(rich(cell),STYLES['TableHeadDoc'] if i==0 else STYLES['TableDoc']) for cell in row] for i,row in enumerate(rows)]
    t=Table(p,colWidths=widths,repeatRows=1,hAlign='LEFT')
    t.setStyle(TableStyle([
        ('VALIGN',(0,0),(-1,-1),'TOP'),('BACKGROUND',(0,0),(-1,0),colors.HexColor('#F2F1F6')),
        ('LINEBELOW',(0,0),(-1,0),.6,colors.HexColor('#D9D9D9')),
        ('LINEBELOW',(0,1),(-1,-1),.35,colors.HexColor('#D9D9D9')),
        ('LEFTPADDING',(0,0),(-1,-1),6),('RIGHTPADDING',(0,0),(-1,-1),6),
        ('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6),
    ]))
    return t

def build(source,path,label,subtitle):
    text = source.read_text(encoding='utf-8')
    if '## 14 Database column appendix' in text:
        text=text.split('## 14 Database column appendix')[0].rstrip()+'\n\n## 14 Database column appendix\n\n'+APPENDIX_INTRO+'\n\n'+dictionary()+'\n'
        # Mechanically generated reference material, not hand-authored prose edits.
        source.write_text(text,encoding='utf-8')
    lines=text.splitlines()
    story=[Spacer(1,56),Paragraph('NEXQON SCHOOL APP',STYLES['SmallDoc']),Spacer(1,12),
           Paragraph(label,STYLES['CoverDoc']),Paragraph(subtitle,STYLES['BodyDoc']),Spacer(1,26),
           Paragraph('Version '+('1.1' if label=='Business document' else '1.0')+'<br/>13 October 2026',STYLES['BodyDoc']),Spacer(1,36),
           Paragraph('Implemented workflows, access boundaries and remaining decisions. Prepared from the application repository and recorded trial checks. No production service level or financial certification is implied.',STYLES['SmallDoc']),PageBreak(),
           Paragraph('Contents',STYLES['H1Doc'])]
    toc=TableOfContents()
    toc.levelStyles=[ParagraphStyle('TOCDoc',fontName='DocSans',fontSize=10.5,leading=17,leftIndent=0,rightIndent=0,textColor=INK,spaceBefore=5)]
    story.extend([toc,PageBreak()])
    i=2
    while i<len(lines):
        line=lines[i].strip()
        if not line:
            i+=1
            continue
        if line.startswith('Version '):
            i+=1
            continue
        if line.startswith('```mermaid'):
            j=i+1
            while j<len(lines) and not lines[j].startswith('```'):
                j+=1
            seq=Sequence('\n'.join(lines[i+1:j]))
            story.extend([seq,Spacer(1,12)])
            i=j+1
            continue
        if line.startswith('|'):
            rows=[]
            while i<len(lines) and lines[i].strip().startswith('|'):
                cells=[x.strip() for x in lines[i].strip().strip('|').split('|')]
                if not all(re.fullmatch(r':?-+:?',x) for x in cells):
                    rows.append(cells)
                i+=1
            story.extend([table(rows),Spacer(1,10)])
            continue
        if line.startswith('## '):
            if line.startswith('## 8 Sequence') or line.startswith('## 14 Database'):
                story.append(PageBreak())
            story.append(Paragraph(rich(line[3:]),STYLES['H1Doc']))
        elif line.startswith('### '):
            heading=Paragraph(rich(line[4:]),STYLES['H2Doc'])
            story.append(heading)
        elif line.startswith('#### '):
            story.append(Paragraph(rich(line[5:]),STYLES['H2Doc']))
        elif re.match(r'^(\d+\.|-) ',line):
            story.append(Paragraph(rich(line),STYLES['BulletDoc']))
        elif line.startswith('<!--'):
            pass
        elif line.startswith('Table identifier:') or line.startswith('Owned application tables:'):
            story.append(Paragraph(rich(line),STYLES['IdentifierDoc']))
        else:
            story.append(Paragraph(rich(line),STYLES['BodyDoc']))
        i+=1
    doc=Document(path,label)
    doc.multiBuild(story)
    reader=PdfReader(path)
    pages=[page.extract_text() or '' for page in reader.pages]
    assert all(len(t.strip())>40 for t in pages), 'Blank PDF page'
    assert 'DATABASE_DICTIONARY' not in '\n'.join(pages)
    print(f'{path.name}: {len(pages)} pages; {len(text.split())} source words')

build(ROOT/'docs/nexqon-business-document.md',OUT/'Nexqon School App Business Document.pdf','Business document',
      'Product scope, school operating workflows, access boundaries and pilot readiness')
build(ROOT/'docs/nexqon-technical-document.md',OUT/'Nexqon School App Technical Document.pdf','Technical document',
      'Service architecture, API catalogue, nine sequence flows and database reference')
