import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import brandLogo from '@/assets/lapitaya-mark.svg?url';
import './design/global.css';
import './i18n';
import { LA_PITAYA_NAME } from '@shared/lapitaya/brand';

document.title = LA_PITAYA_NAME;

const favicon = document.createElement('link');
favicon.rel = 'icon';
favicon.type = 'image/svg+xml';
favicon.href = brandLogo;
document.head.appendChild(favicon);

const splashMark = document.querySelector('#cth-splash .mk');
if (splashMark) {
  const img = document.createElement('img');
  img.src = brandLogo;
  img.alt = LA_PITAYA_NAME;
  img.style.cssText = 'height:56px;width:auto;display:block';
  splashMark.replaceWith(img);
}

const root = document.getElementById('root');
if (!root) throw new Error('No root element');

import { CompanionApp } from './companions/CompanionApp';

const isCompanion =
  window.location.search.includes('companion=1') ||
  window.location.hash.includes('companion');

if (isCompanion) {
  const splash = document.getElementById('cth-splash');
  if (splash) splash.remove();
}

createRoot(root).render(
  <StrictMode>
    {isCompanion ? <CompanionApp /> : <App />}
  </StrictMode>
);
