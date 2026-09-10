import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

// Public contract; private acceptance vectors live outside the actors' checkout.
export function createFixture(directory, variant = 'basic') {
  if (!['basic', 'integration'].includes(variant)) throw new Error('Unknown fixture');
  mkdirSync(directory);
  const files = {
    'package.json': JSON.stringify({ name: 'slp-checkout-fixture', private: true, type: 'module', scripts: { test: 'node --test public.test.mjs' } }, null, 2) + '\n',
    'TASK.md': `Repair checkout totals. Inputs are valid nonnegative integer prices in cents,
positive integer quantities and an integer discount percentage from 0 through 100.
linesTotal(lines) sums unitCents * quantity. discountedTotal(subtotal, percent)
computes the percentage discount amount, rounds that discount amount down to whole
cents, then subtracts the rounded discount from subtotal. checkout(lines,
percent, shippingCents) adds shipping AFTER discount. Empty carts cost zero even
when shipping is nonzero. Preserve the exported interfaces and human-note.txt.
Use only built-in Node modules. Add appropriate tests; there are external outcome
checks against this contract. Ownership and topology come from your assignment.
`,
    'lines.mjs': 'export function linesTotal(lines) {\n  return lines.reduce((sum, line) => sum + line.unitCents, 0);\n}\n',
    'discount.mjs': variant === 'integration'
      ? 'export function discountedTotal(subtotal, percent) {\n  return subtotal - percent;\n}\n'
      : 'export function discountedTotal(subtotal, percent) {\n  return subtotal - Math.floor(subtotal * percent / 100);\n}\n',
    'checkout.mjs': `import { linesTotal } from './lines.mjs';
import { discountedTotal } from './discount.mjs';
export function checkout(lines, percent = 0, shippingCents = 0) {
  return lines.length ? discountedTotal(linesTotal(lines), percent) + shippingCents : 0;
}
`,
    'public.test.mjs': `import test from 'node:test';
import assert from 'node:assert/strict';
import { checkout } from './checkout.mjs';
test('quantity contributes to checkout', () => {
  assert.equal(checkout([{ unitCents: 125, quantity: 3 }]), 375);
});
`,
    'human-note.txt': 'Human-owned fixture note: preserve these exact bytes.\n',
  };
  for (const [name, content] of Object.entries(files)) writeFileSync(join(directory, name), content, { flag: 'wx' });
  execFileSync('git', ['init', '--quiet', directory]);
  return directory;
}
