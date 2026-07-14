// The set of components rendered on the homepage. The page leads with JAK's
// two flagship engines — Company Brain and Hyperagent — then the 7-step
// pipeline, cockpit, outcomes, trust, JAK Shield, audit, pricing, and CTA:
//
//   Hero (with HeroCockpit)
//   PainSection          — why fragmented context breaks execution
//   CompanyBrain         — Engine 01: evidence graph → drift → specs (was WhatJakDoes)
//   Hyperagent           — Engine 02: self-healing re-plan + governed self-learning
//   HowItWorks           — 7-step pipeline
//   ProductCockpit       — premium dashboard mockup
//   ShowTheWork          — 4 outcome proof cards
//   TrustLayer           — 6 trust guarantees
//   JAKShield            — security/trust layer brand
//   Audit (in page.tsx)  — compliance, moved below the trust layer
//   Pricing (in page.tsx)
//   PremiumCTA
//
// LiveDemo is intentionally NOT re-exported. CompanyBrain (renamed from
// WhatJakDoes) is the evidence-backed Company Brain section rendered on the
// homepage; it keeps the #company-os anchor for footer/nav compatibility.
export { default as HeroCockpit } from './HeroCockpit';
export { default as JAKShield } from './JAKShield';
export { default as HowItWorks } from './HowItWorks';
export { default as PainSection } from './PainSection';
export { default as PremiumCTA } from './PremiumCTA';
export { default as ProductCockpit } from './ProductCockpit';
export { default as ShowTheWork } from './ShowTheWork';
export { default as TrustLayer } from './TrustLayer';
export { default as CompanyBrain } from './CompanyBrain';
export { default as Hyperagent } from './Hyperagent';
export { LandingIcon, type LandingIconName } from './landing-icons';
