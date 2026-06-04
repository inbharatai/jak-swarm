// The set of components rendered on the homepage. The page was rebuilt
// 2026-04-30 around a new 9-section structure:
//
//   Hero (with HeroCockpit)
//   PainSection          — why fragmented context breaks execution
//   WhatJakDoes          — company operating layer wedge
//   HowItWorks           — 7-step pipeline
//   ProductCockpit       — premium dashboard mockup
//   ShowTheWork          — 4 outcome proof cards
//   TrustLayer           — 6 trust guarantees
//   Audit (in page.tsx)  — compliance, moved below the trust layer
//   Pricing (in page.tsx)
//   PremiumCTA
//
// LiveDemo is intentionally NOT re-exported. WhatJakDoes is the evidence-
// backed Company OS section now rendered on the homepage.
export { default as HeroCockpit } from './HeroCockpit';
export { default as JAKShield } from './JAKShield';
export { default as HowItWorks } from './HowItWorks';
export { default as PainSection } from './PainSection';
export { default as PremiumCTA } from './PremiumCTA';
export { default as ProductCockpit } from './ProductCockpit';
export { default as ShowTheWork } from './ShowTheWork';
export { default as TrustLayer } from './TrustLayer';
export { default as WhatJakDoes } from './WhatJakDoes';
export { LandingIcon, type LandingIconName } from './landing-icons';
