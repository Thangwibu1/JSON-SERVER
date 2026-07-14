import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import handler from '../api/index.mjs';

let server;
let baseUrl;

before(async () => {
  server = http.createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch((error) => {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: error.message }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test('serves API metadata and seeded collections', async () => {
  const metadataResponse = await fetch(baseUrl);
  assert.equal(metadataResponse.status, 200);
  const metadata = await metadataResponse.json();
  assert.equal(metadata.name, 'Movie Theater API');
  assert.equal(metadata.resources.MOVIE, 20);

  const moviesResponse = await fetch(`${baseUrl}/MOVIE`);
  assert.equal(moviesResponse.status, 200);
  const movies = await moviesResponse.json();
  assert.equal(movies.length, 20);
  assert.equal(movies[0].movieId, 'mov_001');
});

test('supports collection filtering and item lookup', async () => {
  const filteredResponse = await fetch(`${baseUrl}/ACCOUNT?username=admin_huy`);
  assert.equal(filteredResponse.status, 200);
  const accounts = await filteredResponse.json();
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].passwordHash, 'example123');

  const itemResponse = await fetch(`${baseUrl}/ACCOUNT/acc_001`);
  assert.equal(itemResponse.status, 200);
  assert.equal((await itemResponse.json()).username, 'admin_huy');
});

test('supports POST, PUT, PATCH and DELETE CRUD operations', async () => {
  const createdResponse = await fetch(`${baseUrl}/PROMOTION`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      promotionId: 'promo_test',
      code: 'TEST',
      title: 'Test promotion',
      discountType: 'PERCENTAGE',
      discountValue: 10,
      status: 'ACTIVE',
    }),
  });
  assert.equal(createdResponse.status, 201);

  const putResponse = await fetch(`${baseUrl}/PROMOTION/promo_test`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      promotionId: 'promo_test',
      code: 'TEST2',
      title: 'Replaced promotion',
      discountType: 'PERCENTAGE',
      discountValue: 15,
      status: 'ACTIVE',
    }),
  });
  assert.equal(putResponse.status, 200);
  assert.equal((await putResponse.json()).code, 'TEST2');

  const patchResponse = await fetch(`${baseUrl}/PROMOTION/promo_test`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'INACTIVE' }),
  });
  assert.equal(patchResponse.status, 200);
  assert.equal((await patchResponse.json()).status, 'INACTIVE');

  const deleteResponse = await fetch(`${baseUrl}/PROMOTION/promo_test`, { method: 'DELETE' });
  assert.equal(deleteResponse.status, 200);
  assert.equal((await fetch(`${baseUrl}/PROMOTION/promo_test`)).status, 404);
});

test('register creates both account and member profile', async () => {
  const registerResponse = await fetch(`${baseUrl}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'vercel_test_member',
      password: 'secret123',
      fullName: 'Vercel Test',
      email: 'vercel-test@example.com',
      phoneNumber: '0900000000',
      dateOfBirth: '2000-01-01',
      gender: 'Male',
      identityCard: '1234567890',
      address: '123 Test Street',
      role: 'ADMIN',
      status: 'LOCKED',
    }),
  });
  assert.equal(registerResponse.status, 201);
  const result = await registerResponse.json();
  assert.equal(result.account.role, 'MEMBER');
  assert.equal(result.account.status, 'ACTIVE');
  assert.equal(result.memberProfile.accountId, result.account.accountId);
});

test('register rejects missing address and duplicate phone or identity card', async () => {
  const missingAddressResponse = await fetch(`${baseUrl}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'missing_address_member',
      password: 'secret123',
      fullName: 'Missing Address',
      email: 'missing-address@example.com',
      phoneNumber: '0911111111',
      dateOfBirth: '2000-01-01',
      gender: 'Male',
      identityCard: '1234567891',
    }),
  });
  assert.equal(missingAddressResponse.status, 400);

  const duplicatePhoneResponse = await fetch(`${baseUrl}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'duplicate_phone_member',
      password: 'secret123',
      fullName: 'Duplicate Phone',
      email: 'duplicate-phone@example.com',
      phoneNumber: '0900000000',
      dateOfBirth: '2000-01-01',
      gender: 'Male',
      identityCard: '1234567892',
      address: '456 Test Street',
    }),
  });
  assert.equal(duplicatePhoneResponse.status, 409);

  const duplicateIdentityCardResponse = await fetch(`${baseUrl}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'duplicate_identity_member',
      password: 'secret123',
      fullName: 'Duplicate Identity',
      email: 'duplicate-identity@example.com',
      phoneNumber: '0922222222',
      dateOfBirth: '2000-01-01',
      gender: 'Male',
      identityCard: '1234567890',
      address: '789 Test Street',
    }),
  });
  assert.equal(duplicateIdentityCardResponse.status, 409);
});

test('serves Swagger and CORS preflight', async () => {
  const swaggerResponse = await fetch(`${baseUrl}/swagger.json`);
  assert.equal(swaggerResponse.status, 200);
  assert.equal((await swaggerResponse.json()).openapi, '3.0.3');

  const optionsResponse = await fetch(`${baseUrl}/MOVIE`, { method: 'OPTIONS' });
  assert.equal(optionsResponse.status, 204);
  assert.equal(optionsResponse.headers.get('access-control-allow-origin'), '*');
});
