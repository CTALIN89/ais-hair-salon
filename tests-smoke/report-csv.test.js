'use strict';

/**
 * Проверка сериализации отчёта в CSV. 
 */

const { expect } = require('chai');
const Report = require('../src/models/Report');

describe('Report.toCsv (smoke)', function () {
  it('возвращает UTF-8 с BOM и содержит данные', function () {
    const csv = Report.toCsv({
      type: 'revenue',
      date_from: '2024-01-01',
      date_to: '2024-01-31',
      items: [
        { label: 'Стрижки', value_num: 1500, value_text: '3 записей', sort_order: 0 },
      ],
    });
    expect(csv.charCodeAt(0)).to.equal(0xFEFF);
    expect(csv).to.include('Стрижки');
    expect(csv).to.include('1500');
  });

  it('экранирует запятые и кавычки по RFC 4180', function () {
    const csv = Report.toCsv({
      type: 'revenue',
      date_from: '2024-01-01',
      date_to: '2024-01-31',
      items: [
        { label: 'Foo, bar "baz"', value_num: 100, value_text: '', sort_order: 0 },
      ],
    });
    expect(csv).to.include('"Foo, bar ""baz"""');
  });

  it('пустой items — только шапка и метаданные', function () {
    const csv = Report.toCsv({
      type: 'master_load',
      date_from: '2024-01-01',
      date_to: '2024-01-31',
      items: [],
    });
    expect(csv.charCodeAt(0)).to.equal(0xFEFF);
    expect(csv).to.include('master_load');
    expect(csv).to.include('label,value_num,value_text,sort_order');
  });
});
