// The set of components rendered on the homepage. The page was rebuilt
// 2026-04-30 around a new 9-section structure:
//
//   Hero (with HeroCockpit)
//   PainSection          — "AI chat gives answers. JAK gets work done."
//   HowItWorks           — 7-step pipeline
//   ProductCockpit       — premium dashboard mockup
//   ShowTheWork          — 4 outcome proof cards
//   TrustLayer           — 6 trust guarantees
//   Audit (in page.tsx)  — compliance, moved below the trust layer
//   Pricing (in page.tsx)
//   PremiumCTA
//
// LiveDemo + WhatJakDoes are intentionally NOT re-exported. Their roles
// are now covered by HeroCockpit + ProductCockpit + HowItWorks. The files
// remain in this folder for reuse on /docs or marketing sub-pages.
export { default as HeroCockpit } from './HeroCockpit';
export { default as JAKShield } from './JAKShield';
export { default as HowItWorks } from './HowItWorks';
export { default as PainSection } from './PainSection';
export { default as PremiumCTA } from './PremiumCTA';
export { default as ProductCockpit } from './ProductCockpit';
export { default as ShowTheWork } from './ShowTheWork';
export { default as TrustLayer } from './TrustLayer';
export { LandingIcon, type LandingIconName } from './landing-icons';
