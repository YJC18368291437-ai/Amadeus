import { useSyncExternalStore } from 'react';

let locale;
let subscribe = () => () => {};
export function setAmadeusLocale(runtime) { locale = runtime; subscribe = runtime?.subscribe?.bind(runtime) || subscribe; }
const snapshot = () => locale?.getSnapshot?.().active || (typeof navigator !== 'undefined' && navigator.language?.startsWith('en') ? 'en' : 'zh');
export function useAmadeusLocale() { return useSyncExternalStore(subscribe, snapshot, () => 'zh'); }
export function tr(zh, en) { return snapshot().startsWith('en') ? en : zh; }
