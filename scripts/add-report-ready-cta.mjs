import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const indexPath = join(root, '..', 'dist', 'index.html');
const appPath = join(root, '..', 'dist', 'assets', 'app.js');

function replaceOnce(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`Report-ready CTA: marker not found for ${label}`);
  return source.replace(from, to);
}

function insertAfterSuccessCopy(index) {
  if (index.includes('id="reportReadyBtn"')) return index;
  const pattern = /(<p id="successDeliveryCopy">[\s\S]*?<\/p>)(\s*<div class="report-delivery-note")/;
  if (!pattern.test(index)) throw new Error('Report-ready CTA: success copy block not found');

  const cta = `
          <button type="button" class="report-ready-btn" id="reportReadyBtn" aria-controls="report">
            <span>VEDI IL TUO REPORT</span>
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>`;

  return index.replace(pattern, `$1${cta}$2`);
}

function addClientBehaviour(app) {
  app = replaceOnce(
    app,
    "  manualRoute:$('manualRoute'), viewReportBtn:$('viewReportBtn'),",
    "  manualRoute:$('manualRoute'), viewReportBtn:$('viewReportBtn'), reportReadyBtn:$('reportReadyBtn'),",
    'report button element'
  );

  const safeScrollMarker = `function safeScroll(element, block){
  if(!element || typeof element.scrollIntoView !== 'function') return;
  element.scrollIntoView({behavior: motion(), block: block || 'center'});
}
`;
  const focusFunction = `${safeScrollMarker}
function focusGeneratedReport(){
  if(!els.report) return;
  els.report.classList.remove('report-focus');
  void els.report.offsetWidth;
  els.report.classList.add('report-focus');
  els.report.setAttribute('tabindex', '-1');
  safeScroll(els.report, 'start');
  window.setTimeout(() => {
    try { els.report.focus({preventScroll:true}); } catch(error) { /* progressive enhancement */ }
  }, motion() === 'smooth' ? 360 : 0);
  window.setTimeout(() => els.report?.classList.remove('report-focus'), 1800);
}
`;
  app = replaceOnce(app, safeScrollMarker, focusFunction, 'report focus behaviour');

  app = replaceOnce(
    app,
    "if(els.viewReportBtn) els.viewReportBtn.addEventListener('click', markReportViewedWithoutBill);",
    "if(els.viewReportBtn) els.viewReportBtn.addEventListener('click', markReportViewedWithoutBill);\nif(els.reportReadyBtn) els.reportReadyBtn.addEventListener('click', focusGeneratedReport);",
    'report button event listener'
  );

  return app;
}

let index = await readFile(indexPath, 'utf8');
let app = await readFile(appPath, 'utf8');

index = insertAfterSuccessCopy(index);
app = addClientBehaviour(app);

await writeFile(indexPath, index);
await writeFile(appPath, app);
console.log('ECON report-ready CTA injected into preview build.');
