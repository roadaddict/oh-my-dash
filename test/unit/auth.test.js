import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ipInCidr, authorize } from '../../lib/auth.js';

test('ipInCidr: v4 and v6 ranges', () => {
  assert.ok(ipInCidr('203.0.113.7', '203.0.113.0/24'));
  assert.ok(!ipInCidr('203.0.114.7', '203.0.113.0/24'));
  assert.ok(ipInCidr('203.0.113.7', '203.0.113.7'));
  assert.ok(ipInCidr('2001:db8:1234::1', '2001:db8:1234::/48'));
  assert.ok(!ipInCidr('2001:db8:1235::1', '2001:db8:1234::/48'));
  assert.ok(!ipInCidr('203.0.113.7', '2001:db8::/32'));
});

test('authorize: allowed IPs, nothing configured = nobody', async () => {
  const req = (ip) => new Request('https://d.example/api/state', { headers: { 'CF-Connecting-IP': ip } });
  assert.equal(await authorize(req('203.0.113.7'), { ALLOWED_IPS: '203.0.113.0/24' }), 'ip:203.0.113.7');
  assert.equal(await authorize(req('198.51.100.1'), { ALLOWED_IPS: '203.0.113.0/24' }), null);
  assert.equal(await authorize(req('198.51.100.1'), {}), null);
});
