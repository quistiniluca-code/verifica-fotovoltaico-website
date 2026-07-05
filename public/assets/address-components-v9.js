(() => {
  'use strict';

  const byId = id => document.getElementById(id);
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  const contactBlock = byId('contactBlock');
  const manualRoute = byId('manualRoute');
  const manualHint = byId('manualRouteHint');
  const hiddenAddress = byId('iaddress');
  const province = byId('iProvince');
  const municipality = byId('iComune');
  const street = byId('iVia');
  const civic = byId('iCivico');

  if (!contactBlock || !manualRoute || !hiddenAddress || !province || !municipality || !street || !civic) return;

  function composeAddress() {
    const streetLine = [normalize(street.value), normalize(civic.value)].filter(Boolean).join(', ');
    const localityLine = [normalize(municipality.value), normalize(province.value)].filter(Boolean).join(', ');
    return [streetLine, localityLine].filter(Boolean).join(' — ');
  }

  function syncAddress() {
    const composed = composeAddress();
    if (hiddenAddress.value !== composed) {
      hiddenAddress.value = composed;
      hiddenAddress.dispatchEvent(new Event('input', { bubbles: true }));
      hiddenAddress.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function setManualOpen(open, focus) {
    contactBlock.hidden = !open;
    contactBlock.classList.toggle('manual-open', open);
    manualRoute.setAttribute('aria-expanded', String(open));
    if (manualHint) manualHint.textContent = open ? 'Puoi tornare alla bolletta in qualsiasi momento.' : 'Inserisci i dati solo se non hai la bolletta.';
    if (open && focus) {
      window.setTimeout(() => province.focus({ preventScroll: true }), 0);
    }
  }

  manualRoute.addEventListener('click', event => {
    event.preventDefault();
    setManualOpen(true, true);
    contactBlock.scrollIntoView({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }, true);

  [province, municipality, street, civic].forEach(field => {
    field.addEventListener('input', syncAddress);
    field.addEventListener('change', syncAddress);
  });

  const observer = new MutationObserver(() => {
    if (contactBlock.classList.contains('bill-first-ready')) {
      contactBlock.hidden = true;
    }
  });
  observer.observe(contactBlock, { attributes: true, attributeFilter: ['class'] });

  setManualOpen(false, false);
  syncAddress();
})();
