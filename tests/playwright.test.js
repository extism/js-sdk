import { test, expect } from '@playwright/test';

test('tape succeeds', async ({ page }) => {
  const finished = new Promise(resolve => {
    page.on('console', msg => {
      if (/^# (not )?ok/.test(msg.text())) {
        resolve()
      }
    })
  })

  page.on('console', msg => console.log('>', msg.text()))
  page.on('pageerror', err => {
    console.error(err);
    expect(err).toBeNull();
  });

  page.on('console', msg => {
    expect(msg.text()).not.toMatch(/^not ok/)
  });
  await page.goto('http://localhost:8124/dist/tests/browser/');
  await finished
});
