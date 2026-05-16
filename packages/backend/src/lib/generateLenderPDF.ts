import {
  PDFDocument,
  PDFPage,
  PDFName,
  PDFArray,
  PDFString,
  rgb,
  StandardFonts,
} from 'pdf-lib';
import fs from 'fs';
import path from 'path';

const NAVY  = rgb(0.08, 0.10, 0.18);
const TEAL  = rgb(0.18, 0.80, 0.78);
const WHITE = rgb(1, 1, 1);
const LGRAY = rgb(0.92, 0.93, 0.95);
const DGRAY = rgb(0.30, 0.32, 0.38);
const LINK  = rgb(0.10, 0.55, 0.85);

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 28;
const COL2_X = 210;

type AppData = Record<string, any>;
type PageMeta = { page: PDFPage; pageNum: number };

function addLinkAnnotation(
  doc: PDFDocument,
  page: PDFPage,
  url: string,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const annot = doc.context.obj({
    Type:    PDFName.of('Annot'),
    Subtype: PDFName.of('Link'),
    Rect:    [x, y, x + w, y + h],
    Border:  [0, 0, 0],
    C:       [],
    A: {
      Type: PDFName.of('Action'),
      S:    PDFName.of('URI'),
      URI:  PDFString.of(url),
    },
  });
  const annots = page.node.get(PDFName.of('Annots')) as PDFArray | undefined;
  if (annots) {
    annots.push(doc.context.register(annot));
  } else {
    page.node.set(
      PDFName.of('Annots'),
      doc.context.obj([doc.context.register(annot)]),
    );
  }
}

function drawFooter(
  page: PDFPage,
  pageNum: number,
  totalPages: number,
  font: any,
  appId: string,
) {
  page.drawLine({
    start: { x: MARGIN, y: 42 },
    end:   { x: PAGE_W - MARGIN, y: 42 },
    thickness: 0.5,
    color: TEAL,
  });
  page.drawText('Confidential — Didact Capital LLC  |  didactcapital.fund', {
    x: MARGIN, y: 28, size: 7, font, color: DGRAY,
  });
  page.drawText(`Application ID: ${appId}`, {
    x: PAGE_W - 200, y: 28, size: 7, font, color: DGRAY,
  });
  const pageLabel = `Page ${pageNum} of ${totalPages}`;
  page.drawText(pageLabel, {
    x: PAGE_W / 2 - (pageLabel.length * 2.2),
    y: 28,
    size: 7,
    font,
    color: DGRAY,
  });
}

export async function generateLenderPDF(
  app: AppData,
  lead: AppData,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Didact Capital — ${app.business_legal_name ?? app.id}`);
  doc.setAuthor('Didact Capital LLC');
  doc.setCreator('RoboRebut Export v1');

  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const regFont  = await doc.embedFont(StandardFonts.Helvetica);

  const logoPath  = path.join(process.cwd(), 'src/assets/didact-logo.png');
  const logoBytes = fs.readFileSync(logoPath);
  const logoImage = await doc.embedPng(logoBytes);

  const pages: PageMeta[] = [];
  let currentPage!: PDFPage;
  let y = 0;

  function newPage(): PDFPage {
    const p = doc.addPage([PAGE_W, PAGE_H]);
    pages.push({ page: p, pageNum: pages.length + 1 });
    currentPage = p;
    y = PAGE_H - 50;
    return p;
  }

  function ensureSpace(needed: number) {
    if (y - needed < 55) newPage();
  }

  newPage();

  currentPage.drawRectangle({ x: 0, y: PAGE_H - 80, width: PAGE_W, height: 80, color: NAVY });

  const logoDims = logoImage.scale(0.055);
  currentPage.drawImage(logoImage, {
    x: MARGIN, y: PAGE_H - 68,
    width: logoDims.width, height: logoDims.height,
  });

  currentPage.drawText('DIDACT CAPITAL', {
    x: 90, y: PAGE_H - 38, size: 20, font: boldFont, color: WHITE,
  });
  currentPage.drawText('Merchant Application — Lender Package', {
    x: 90, y: PAGE_H - 56, size: 10, font: regFont, color: TEAL,
  });

  const exportDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  currentPage.drawText(`Exported: ${exportDate}`, {
    x: PAGE_W - 165, y: PAGE_H - 50, size: 8, font: regFont, color: LGRAY,
  });

  y = PAGE_H - 100;

  const fmt      = (v: any) => (v === null || v === undefined || v === '') ? '—' : String(v);
  const fmtBool  = (v: any) => v === true  || v === 'true'  ? 'Yes' : v === false || v === 'false' ? 'No' : '—';
  const fmtMoney = (v: any) => {
    if (v === null || v === undefined || v === '') return '—';
    const n = Number(String(v).replace(/[^0-9.-]/g, ''));
    return isNaN(n) ? fmt(v) : `$${n.toLocaleString()}`;
  };

  function addSection(title: string) {
    ensureSpace(38);
    currentPage.drawRectangle({
      x: MARGIN, y: y - 18, width: PAGE_W - MARGIN * 2, height: 22, color: NAVY,
    });
    currentPage.drawText(title.toUpperCase(), {
      x: MARGIN + 6, y: y - 12, size: 9, font: boldFont, color: TEAL,
    });
    y -= 30;
  }

  function addRow(label: string, value: string, shade = false): number {
    ensureSpace(22);
    if (shade) {
      currentPage.drawRectangle({
        x: MARGIN, y: y - 14, width: PAGE_W - MARGIN * 2, height: 18, color: LGRAY,
      });
    }
    currentPage.drawText(label, {
      x: MARGIN + 6, y: y - 10, size: 8, font: boldFont, color: DGRAY,
    });
    currentPage.drawText(value ?? '—', {
      x: COL2_X, y: y - 10, size: 8, font: regFont, color: DGRAY,
    });
    const rowY = y;
    y -= 18;
    return rowY;
  }

  function addLinkRow(label: string, url: string, displayText: string, shade = false) {
    ensureSpace(22);
    if (shade) {
      currentPage.drawRectangle({
        x: MARGIN, y: y - 14, width: PAGE_W - MARGIN * 2, height: 18, color: LGRAY,
      });
    }
    currentPage.drawText(label, {
      x: MARGIN + 6, y: y - 10, size: 8, font: boldFont, color: DGRAY,
    });
    currentPage.drawText(displayText, {
      x: COL2_X, y: y - 10, size: 8, font: regFont, color: LINK,
    });
    const textW = regFont.widthOfTextAtSize(displayText, 8);
    currentPage.drawLine({
      start: { x: COL2_X, y: y - 12 },
      end:   { x: COL2_X + textW, y: y - 12 },
      thickness: 0.4,
      color: LINK,
    });
    addLinkAnnotation(doc, currentPage, url, COL2_X, y - 14, Math.min(textW + 4, PAGE_W - COL2_X - MARGIN), 16);
    y -= 18;
  }

  const gap = () => { y -= 6; };

  addSection('Lead Summary');
  addRow('Lead ID',         fmt(lead?.id));
  addRow('Score',           fmt(lead?.score), true);
  addRow('Verdict',         fmt(lead?.verdict));
  addRow('Qualifier Notes', fmt(lead?.reason), true);
  addRow('Qualified At',    lead?.qualified_at ? new Date(lead.qualified_at).toLocaleString() : '—');
  gap();

  addSection('Business Information');
  addRow('Legal Name',        fmt(app.business_legal_name));
  addRow('DBA',               fmt(app.business_dba), true);
  addRow('Phone',             fmt(app.business_phone));
  addRow('Email',             fmt(app.business_email), true);
  addRow('Address',           [app.business_address, app.business_city, app.business_state, app.business_zip].filter(Boolean).join(', '));
  addRow('Entity Type',       fmt(app.entity_type), true);
  addRow('Start Date',        fmt(app.business_start_date));
  addRow('EIN',               fmt(app.ein), true);
  addRow('Home-Based',        fmtBool(app.home_based));
  addRow('Open Judgements',   fmtBool(app.open_judgements), true);
  addRow('Open Bankruptcies', fmtBool(app.open_bankruptcies));
  addRow('Industry / SIC',    fmt(app.industry_sic), true);
  addRow('Description',       fmt(app.business_description));
  gap();

  addSection('Funding Request');
  addRow('Amount Requested', fmtMoney(app.amount_requested));
  addRow('Timeline Needed',  fmt(app.funds_needed_timeline), true);
  addRow('Use of Funds',     fmt(app.use_of_funds));
  gap();

  addSection('Financials');
  addRow('Gross Annual Sales',  fmtMoney(app.gross_annual_sales));
  addRow('Gross Monthly Sales', fmtMoney(app.gross_monthly_sales), true);
  addRow('Monthly CC Volume',   fmtMoney(app.monthly_cc_volume));
  addRow('Existing Advance',    fmtBool(app.existing_advance), true);
  addRow('Advance Balance',     fmtMoney(app.existing_advance_balance));
  gap();

  addSection('Primary Owner');
  addRow('Name',         `${fmt(app.owner_first_name)} ${fmt(app.owner_last_name)}`);
  addRow('Title',        fmt(app.owner_title), true);
  addRow('Ownership %',  fmt(app.owner_percentage));
  addRow('Address',      [app.owner_address, app.owner_city, app.owner_state, app.owner_zip].filter(Boolean).join(', '), true);
  addRow('DOB',          fmt(app.owner_dob));
  addRow('SSN (last 4)', fmt(app.owner_ssn_last4), true);
  addRow('Phone',        fmt(app.owner_phone));
  gap();

  if (app.coowner_first_name) {
    addSection('Co-Owner');
    addRow('Name',         `${fmt(app.coowner_first_name)} ${fmt(app.coowner_last_name)}`);
    addRow('Title',        fmt(app.coowner_title), true);
    addRow('Ownership %',  fmt(app.coowner_percentage));
    addRow('Address',      fmt(app.coowner_address), true);
    addRow('DOB',          fmt(app.coowner_dob));
    addRow('SSN (last 4)', fmt(app.coowner_ssn_last4), true);
    gap();
  }

  addSection('Uploaded Documents');
  let docUrls: string[] = [];
  try {
    docUrls = Array.isArray(app.document_urls)
      ? app.document_urls
      : JSON.parse(app.document_urls || '[]');
  } catch { docUrls = []; }

  if (docUrls.length === 0) {
    addRow('Documents', 'No documents uploaded');
  } else {
    docUrls.forEach((url, i) => {
      const filename = decodeURIComponent(url.split('/').pop()?.split('?')[0] ?? `Document ${i + 1}`);
      addLinkRow(`Document ${i + 1}`, url, filename, i % 2 === 0);
    });
  }
  gap();

  addSection('Signature');
  addRow('Signed By',  fmt(app.signature_name));
  addRow('Agreed',     fmtBool(app.signature_agreed), true);
  addRow('Timestamp',  app.signature_timestamp ? new Date(app.signature_timestamp).toLocaleString() : '—');

  // Legal disclosure block below signature
  y -= 10;
  ensureSpace(80);

  currentPage.drawRectangle({
    x: MARGIN, y: y - 72,
    width: PAGE_W - MARGIN * 2, height: 76,
    color: LGRAY,
  });

  currentPage.drawText('AUTHORIZATION & DISCLOSURE', {
    x: MARGIN + 8, y: y - 14,
    size: 8, font: boldFont, color: NAVY,
  });

  const disclosureLines = [
    'By submitting this application, the applicant(s) named above authorized Didact Capital LLC and its',
    'funding partners to obtain business and personal credit reports, verify all information provided,',
    'and share this application with prospective lenders and capital providers for the purpose of',
    'evaluating and funding a business cash advance or loan. The applicant certifies that all information',
    'contained in this application is true, accurate, and complete to the best of their knowledge.',
    'Electronic signature constitutes a legally binding agreement under the E-SIGN Act (15 U.S.C. § 7001).',
  ];

  disclosureLines.forEach((line, i) => {
    currentPage.drawText(line, {
      x: MARGIN + 8,
      y: y - 26 - (i * 10),
      size: 6.5,
      font: regFont,
      color: DGRAY,
    });
  });

  y -= 82;

  const totalPages = pages.length;
  for (const { page, pageNum } of pages) {
    drawFooter(page, pageNum, totalPages, regFont, fmt(app.id));
  }

  return doc.save();
}
