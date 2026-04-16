import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { stripe } from "@/lib/stripe";

export async function POST(req: NextRequest) {
  await requireAdmin();

  const {
    customerEmail,
    customerName,
    amountAud,
    description,
    daysUntilDue,
    poNumber,
  } = (await req.json()) as {
    customerEmail: string;
    customerName: string;
    amountAud: number;
    description: string;
    daysUntilDue?: number;
    poNumber?: string;
  };

  if (!customerEmail || !amountAud || !description) {
    return NextResponse.json(
      { error: "Missing required fields: customerEmail, amountAud, description" },
      { status: 400 }
    );
  }

  const customers = await stripe.customers.list({
    email: customerEmail,
    limit: 1,
  });

  let customer = customers.data[0];
  if (!customer) {
    customer = await stripe.customers.create({
      email: customerEmail,
      name: customerName,
    });
  }

  await stripe.invoiceItems.create({
    customer: customer.id,
    amount: Math.round(amountAud * 100),
    currency: "aud",
    description,
  });

  const invoice = await stripe.invoices.create({
    customer: customer.id,
    collection_method: "send_invoice",
    days_until_due: daysUntilDue ?? 30,
    ...(poNumber ? { custom_fields: [{ name: "PO Number", value: poNumber }] } : {}),
  });

  const finalizedInvoice = await stripe.invoices.finalizeInvoice(invoice.id);
  await stripe.invoices.sendInvoice(finalizedInvoice.id);

  return NextResponse.json({
    invoiceId: finalizedInvoice.id,
    invoiceUrl: finalizedInvoice.hosted_invoice_url,
    status: finalizedInvoice.status,
  });
}
