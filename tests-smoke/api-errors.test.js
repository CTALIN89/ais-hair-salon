'use strict';

const request = require('supertest');
const { expect } = require('chai');

const app = require('../src/app');

describe('API error handling (smoke)', function () {
  it('404 для несуществующего /api-маршрута возвращает JSON', async function () {
    const res = await request(app).get('/api/definitely-not-a-route');
    expect(res.status).to.equal(404);
    expect(res.headers['content-type']).to.match(/application\/json/);
    expect(res.body).to.have.property('error');
    expect(res.body).to.have.property('message');
  });

  it('404 для несуществующего HTML-маршрута рендерит страницу', async function () {
    const res = await request(app).get('/definitely-not-a-page');
    expect(res.status).to.equal(404);
    expect(res.headers['content-type']).to.match(/text\/html/);
    expect(res.text).to.include('404');
  });

  it('GET /api/auth/me без сессии → 401 JSON', async function () {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).to.equal(401);
    expect(res.headers['content-type']).to.match(/application\/json/);
    expect(res.body).to.have.property('error');
    expect(res.body).to.have.property('message');
  });
});
