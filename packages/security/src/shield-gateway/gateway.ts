import { LocalShieldGateway } from './local-shield-gateway.js';
import type { ShieldGateway } from './types.js';

const localShieldGateway = new LocalShieldGateway();
let overrideGateway: ShieldGateway | null = null;

export function getShieldGateway(): ShieldGateway {
  return overrideGateway ?? localShieldGateway;
}

export function createLocalShieldGateway(): ShieldGateway {
  return new LocalShieldGateway();
}

export function setShieldGateway(gateway: ShieldGateway | null): void {
  overrideGateway = gateway;
}

export const setShieldGatewayForTesting = setShieldGateway;
