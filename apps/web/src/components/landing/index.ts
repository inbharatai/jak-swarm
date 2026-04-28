// The narrow set of components rendered on the homepage today. The
// homepage was simplified from ~18 sections down to 8 (hero, pillars,
// outcomes, workflow, audit tile, live demo, pricing, final CTA), so
// OrchestrationEngine / ExecutionFlow / CapabilityMap / SupervisorSection
// are intentionally NOT re-exported — they remain in the folder for use
// on /docs or marketing sub-pages but should not be re-added to the
// homepage without explicit owner approval.
export { default as LiveDemo } from './LiveDemo';
export { default as PremiumCTA } from './PremiumCTA';
export { default as ShowTheWork } from './ShowTheWork';
export { default as WhatJakDoes } from './WhatJakDoes';
export { LandingIcon, type LandingIconName } from './landing-icons';
