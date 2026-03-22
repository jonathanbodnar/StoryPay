import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { getAgencyWebhook, setAgencyWebhook, deleteAgencyWebhook } from '@/lib/lunarpay';

async function verifyAdmin() {
  const cookieStore = await cookies();
  const adminToken = cookieStore.get('admin_token')?.value;
  return adminToken && adminToken === process.env.ADMIN_SECRET;
}

export async function GET() {
  if (!(await verifyAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await getAgencyWebhook();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  if (!(await verifyAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { webhookUrl } = await request.json();
  if (!webhookUrl) {
    return NextResponse.json({ error: 'webhookUrl is required' }, { status: 400 });
  }

  try {
    const result = await setAgencyWebhook(webhookUrl);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 });
  }
}

export async function DELETE() {
  if (!(await verifyAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await deleteAgencyWebhook();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 });
  }
}
