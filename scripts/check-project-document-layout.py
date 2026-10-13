"""Create full-scale page contact sheets and check extracted document contents."""
from pathlib import Path
from PIL import Image, ImageDraw
from pypdf import PdfReader
ROOT=Path(__file__).resolve().parents[1]
QA=ROOT/'tmp/pdfs/review-final'
for name in ['business','technical']:
    pages=sorted(QA.glob(f'{name}-*.png'))
    for start in range(0,len(pages),6):
        block=pages[start:start+6]
        w,h=Image.open(block[0]).size
        sheet=Image.new('RGB',(w*3,(h+22)*2),'#dadde3')
        draw=ImageDraw.Draw(sheet)
        for i,path in enumerate(block):
            x,y=(i%3)*w,(i//3)*(h+22)
            sheet.paste(Image.open(path),(x,y+22))
            draw.text((x+12,y+3),path.stem,fill='black')
        sheet.save(QA/f'qa-{name}-{start//6+1:02}.png')
technical=PdfReader(ROOT/'output/pdf/Nexqon School App Technical Document.pdf')
for i,page in enumerate(technical.pages,1):
    text=page.extract_text()
    if 'Flow ' in text or 'appendix' in text.lower():
        print('Technical page',i,':',text[:135].replace('\n',' '))
print('Rendered business pages',len(list(QA.glob('business-*.png'))))
print('Rendered technical pages',len(list(QA.glob('technical-*.png'))))
print('Mermaid source diagrams', (ROOT/'docs/nexqon-technical-document.md').read_text(encoding='utf-8').count('```mermaid'))
