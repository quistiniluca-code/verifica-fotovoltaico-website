(() => {
  'use strict';

  const byId = id => document.getElementById(id);
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  const contactBlock = byId('contactBlock');
  const manualRoute = byId('manualRoute');
  const hiddenAddress = byId('iaddress');
  const province = byId('iProvince');
  const municipality = byId('iComune');
  const street = byId('iVia');
  const civic = byId('iCivico');
  const addressFields = [province, municipality, street, civic];
  const manualFields = [
    byId('iname'),
    hiddenAddress,
    province,
    municipality,
    street,
    civic,
    byId('iconsumptionvalue'),
    byId('iannualspend')
  ].filter(Boolean);

  if (!contactBlock || !manualRoute || !hiddenAddress || addressFields.some(field => !field)) return;

  function hasEveryAddressPart() {
    return addressFields.every(field => normalize(field.value));
  }

  function composeAddress() {
    const streetLine = [normalize(street.value), normalize(civic.value)].filter(Boolean).join(', ');
    const localityLine = [normalize(municipality.value), normalize(province.value)].filter(Boolean).join(', ');
    return [streetLine, localityLine].filter(Boolean).join(' — ');
  }

  function syncAddress(forceManualValidation = false) {
    const hasAnyPart = addressFields.some(field => normalize(field.value));
    if (!hasAnyPart && !forceManualValidation) return;
    const composed = hasEveryAddressPart() ? composeAddress() : '';
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
    manualFields.forEach(field => {
      field.required = open;
      field.setAttribute('aria-required', String(open));
    });
    if (open) syncAddress(true);
    if (open && focus) {
      window.setTimeout(() => province.focus({ preventScroll: true }), 0);
    }
  }

  manualRoute.addEventListener('click', event => {
    event.preventDefault();
    setManualOpen(true, true);
    contactBlock.scrollIntoView({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }, true);

  addressFields.forEach(field => {
    field.addEventListener('input', () => syncAddress(true));
    field.addEventListener('change', () => syncAddress(true));
  });

  const observer = new MutationObserver(() => {
    if (contactBlock.classList.contains('bill-first-ready')) {
      manualFields.forEach(field => { field.required = false; field.setAttribute('aria-required', 'false'); });
      contactBlock.hidden = true;
    }
  });
  observer.observe(contactBlock, { attributes: true, attributeFilter: ['class'] });

  setManualOpen(false, false);
})();
