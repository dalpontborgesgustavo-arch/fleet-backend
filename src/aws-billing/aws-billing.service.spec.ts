import type { InvoiceSummary } from '@aws-sdk/client-invoicing';
import {
  AWS_BILLING_OWNER_EMAIL,
  isAwsBillingOwner,
  normalizeInvoices,
} from './aws-billing.service';

describe('AWS billing access and invoices', () => {
  it('libera somente o e-mail proprietário normalizado', () => {
    expect(
      isAwsBillingOwner(`  ${AWS_BILLING_OWNER_EMAIL.toUpperCase()}  `),
    ).toBe(true);
    expect(isAwsBillingOwner('admin@jr.com')).toBe(false);
    expect(isAwsBillingOwner(null)).toBe(false);
  });

  it('agrupa nota fiscal eletrônica e fatura comercial sem duplicar valor', () => {
    const summaries: InvoiceSummary[] = [
      {
        InvoiceId: 'EIN-1',
        CommercialInvoiceId: 'COM-1',
        InvoiceType: 'INVOICE',
        BillingPeriod: { Month: 7, Year: 2026 },
        TaxAuthorityStatus: 'ISSUED',
        PaymentCurrencyAmount: {
          TotalAmount: '100',
          CurrencyCode: 'BRL',
        },
      },
      {
        InvoiceId: 'COM-1',
        InvoiceType: 'INVOICE',
        BillingPeriod: { Month: 7, Year: 2026 },
        DueDate: new Date('2026-08-10T00:00:00.000Z'),
        PaymentCurrencyAmount: {
          TotalAmount: '100',
          TotalAmountBeforeTax: '90',
          CurrencyCode: 'BRL',
          AmountBreakdown: { Taxes: { TotalAmount: '10' } },
        },
      },
    ];

    const invoices = normalizeInvoices(
      summaries,
      new Date('2026-08-20T00:00:00.000Z'),
    );

    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({
      invoiceId: 'COM-1',
      total: 100,
      subtotal: 90,
      tax: 10,
      currency: 'BRL',
      paymentStatus: 'NOT_CONFIRMED_BY_API',
    });
    expect(invoices[0].relatedDocumentIds).toEqual(['EIN-1', 'COM-1']);
  });
});
