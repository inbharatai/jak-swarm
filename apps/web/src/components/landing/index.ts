// The set of components rendered on the homepage. The page leads with JAK's
// two flagship engines — Company Brain and Hyperagent — then the 7-step
// pipeline, cockpit, outcomes, pain framing, trust, JAK Shield, audit,
// pricing, and CTA:
//
//   Hero (with EngineDuo)   — the two engines side by side as the hero visual
//   CompanyBrain            — Engine 01: evidence graph → drift → specs (was WhatJakDoes)
//   Hyperagent              — Engine 02: self-healing re-plan + governed self-learning
//   HowItWorks              — 7-step pipeline
//   ProductCockpit          — premium dashboard mockup (the /workspace surface)
//   ShowTheWork             — 4 outcome proof cards
//   PainSection             — why fragmented context breaks execution (moved below the engines)
//   TrustLayer              — 6 trust guarantees
//   JAKShield               — security/trust layer brand
//   Audit (in page.tsx)     — compliance, moved below the trust layer
//   Pricing (in page.tsx)
//   PremiumCTA
//
// EngineDuo replaces the old HeroCockpit typing demo so the first viewport
// shows the actual IP (Company Brain + Hyperagent) instead of a generic
// workflow animation. CompanyBrain (renamed from WhatJakDoes) keeps the
// #company-os anchor for footer/nav compatibility.
export { default as EngineDuo } from './EngineDuo';
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
