import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '10s', target: 5 },
    { duration: '30s', target: 15 },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<1500'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';
const TOKEN = __ENV.AUTH_TOKEN || '';

export default function () {
  const headers = TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};

  const health = http.get(`${BASE_URL}/health`);
  check(health, { 'health 200/503': (r) => r.status === 200 || r.status === 503 });

  if (TOKEN) {
    const payload = JSON.stringify({ goal: 'CMO + Auto: Review inbharat.ai', roleModes: ['cmo', 'auto'] });
    const res = http.post(`${BASE_URL}/workflows`, payload, {
      headers: { 'Content-Type': 'application/json', ...headers },
    });
    check(res, { 'workflow 202': (r) => r.status === 202 });
  }

  sleep(1);
}