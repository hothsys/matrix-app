const { test, expect } = require('@playwright/test');

test.describe('Server API', () => {
  test.beforeEach(async ({ request }) => {
    // Clear server state before each API test
    await request.post('/api/data', { data: {} });
  });

  test('GET / serves HTML', async ({ request }) => {
    const resp = await request.get('/');
    expect(resp.status()).toBe(200);
    const ct = resp.headers()['content-type'];
    expect(ct).toContain('text/html');
  });

  test('GET /api/data returns empty object when no data', async ({ request }) => {
    const resp = await request.get('/api/data');
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body).toEqual({});
  });

  test('POST /api/data saves and GET retrieves', async ({ request }) => {
    const payload = { version: 2, photos: [], albums: [] };
    const postResp = await request.post('/api/data', { data: payload });
    expect(postResp.status()).toBe(200);
    const postBody = await postResp.json();
    expect(postBody.ok).toBe(true);

    const getResp = await request.get('/api/data');
    expect(getResp.status()).toBe(200);
    const getData = await getResp.json();
    expect(getData.version).toBe(2);
    expect(getData.photos).toEqual([]);
    expect(getData.albums).toEqual([]);
  });

  test('POST /api/data rejects invalid JSON', async ({ request }) => {
    const resp = await request.fetch('/api/data', {
      method: 'POST',
      data: Buffer.from('not json{{{'),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(resp.status()).toBe(400);
  });

  test('POST /api/photos/{id} saves image', async ({ request }) => {
    const dataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
    const resp = await request.post('/api/photos/test-photo-1', {
      data: { dataUrl },
    });
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.ok).toBe(true);
    expect(body.path).toContain('test-photo-1');
  });

  test('POST /api/photos/{id}/thumb saves thumbnail', async ({ request }) => {
    const dataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
    const resp = await request.post('/api/photos/test-photo-2/thumb', {
      data: { dataUrl },
    });
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.ok).toBe(true);
    expect(body.path).toContain('test-photo-2_thumb');
  });

  test('DELETE /api/photos/{id} removes files', async ({ request }) => {
    // First save a photo
    const dataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
    await request.post('/api/photos/test-photo-3', { data: { dataUrl } });
    await request.post('/api/photos/test-photo-3/thumb', { data: { dataUrl } });

    // Delete it
    const resp = await request.delete('/api/photos/test-photo-3');
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.ok).toBe(true);
    expect(body.removed.length).toBeGreaterThan(0);
  });

  test('GET /favicon.ico returns 204', async ({ request }) => {
    const resp = await request.get('/favicon.ico');
    expect(resp.status()).toBe(204);
  });

  test('GET /apple-touch-icon.png returns 204', async ({ request }) => {
    const resp = await request.get('/apple-touch-icon.png');
    expect(resp.status()).toBe(204);
  });
});
