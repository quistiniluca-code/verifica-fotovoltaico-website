(() => {
  'use strict';

  const MEASUREMENT_ID = 'G-SR6B9PPV3J';
  const sent = new Set();

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtag(){ window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', MEASUREMENT_ID, {
    send_page_view: true,
    anonymize_ip: true,
    allow_google_signals: false,
    allow_ad_personalization_signals: false
  });

  const loader = document.createElement('script');
  loader.async = true;
  loader.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(MEASUREMENT_ID)}`;
  document.head.appendChild(loader);

  function track(name, params = {}, onceKey = '') {
    const key = onceKey || '';
    if (key && sent.has(key)) return;
    if (key) sent.add(key);
    try {
      window.gtag('event', name, {
        event_category: 'econ_funnel',
        transport_type: 'beacon',
        ...params
      });
    } catch (_) {
      // Analytics must never interfere with the lead funnel.
    }
  }

  function byId(id) { return document.getElementById(id); }
  function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim()); }
  function validPhone(value) { return String(value || '').replace(/\D/g, '').length >= 8; }

  function checkContacts() {
    const phone = byId('iphone');
    const email = byId('iemail');
    if (phone && email && validPhone(phone.value) && validEmail(email.value)) {
      track('contact_completed', { route: byId('bill')?.files?.length ? 'bill' : 'unknown' }, 'contact_completed');
    }
  }

  function observeClass(element, callback) {
    if (!element) return;
    const observer = new MutationObserver(callback);
    observer.observe(element, { attributes: true, attributeFilter: ['class', 'hidden'], childList: true, subtree: true });
  }

  document.addEventListener('DOMContentLoaded', () => {
    const phone = byId('iphone');
    const email = byId('iemail');
    phone?.addEventListener('input', checkContacts, { passive: true });
    email?.addEventListener('input', checkContacts, { passive: true });

    const bill = byId('bill');
    bill?.addEventListener('change', () => {
      if (bill.files?.length) track('bill_uploaded', { source: 'primary_upload' });
    });

    byId('manualRoute')?.addEventListener('click', () => track('manual_route_opened', {}, 'manual_route_opened'));
    byId('waLink')?.addEventListener('click', () => track('whatsapp_clicked'));
    byId('reportReadyBtn')?.addEventListener('click', () => track('view_report_clicked'));
    byId('viewReportBtn')?.addEventListener('click', () => track('view_report_clicked'));

    const report = byId('report');
    const reportCheck = () => {
      if (report?.classList.contains('show')) {
        track('report_generated', { route: bill?.files?.length ? 'bill' : 'manual' }, 'report_generated');
      }
    };
    observeClass(report, reportCheck);
    reportCheck();

    const successState = byId('successState');
    const successEyebrow = byId('successEyebrow');
    const leadCheck = () => {
      const visible = successState && (successState.classList.contains('show') || !successState.hidden);
      const label = String(successEyebrow?.textContent || '').toLowerCase();
      if (visible && (label.includes('presa in carico') || label.includes('confermato') || label.includes('confermata'))) {
        track('lead_saved', { route: bill?.files?.length ? 'bill' : 'manual' }, 'lead_saved');
      }
    };
    observeClass(successState, leadCheck);
    observeClass(successEyebrow, leadCheck);
  });
})();
