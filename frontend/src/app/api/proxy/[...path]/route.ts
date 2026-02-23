import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// Vercel serverless function timeout (max 60s for Pro, 10s for Free)
export const maxDuration = 60;

async function proxyRequest(
  request: NextRequest,
  params: { path: string[] },
  method: string
) {
  const path = params.path.join('/');
  const searchParams = request.nextUrl.searchParams.toString();
  const url = `${BACKEND_URL}/api/${path}${searchParams ? `?${searchParams}` : ''}`;

  console.log(`[Proxy ${method}]`, url);

  try {
    const fetchOptions: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };

    // Body가 있는 메서드
    if (['POST', 'PUT', 'PATCH'].includes(method)) {
      const body = await request.json();
      fetchOptions.body = JSON.stringify(body);

      // LLM 분석 등 긴 작업용 타임아웃 (5분)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 300000);
      fetchOptions.signal = controller.signal;

      const response = await fetch(url, fetchOptions);
      clearTimeout(timeoutId);

      const data = await response.json();
      return NextResponse.json(data, { status: response.status });
    }

    const response = await fetch(url, fetchOptions);
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error: any) {
    console.error(`[Proxy ${method} Error]`, error);
    if (error?.cause) {
      console.error(`[Proxy ${method} Cause]`, error.cause);
    }
    const message = error?.cause?.code === 'UND_ERR_CONNECT_TIMEOUT'
      ? 'Backend connection timed out'
      : `Backend request failed: ${String(error)}`;
    return NextResponse.json(
      { detail: message },
      { status: 502 }
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  return proxyRequest(request, params, 'GET');
}

export async function POST(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  return proxyRequest(request, params, 'POST');
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  return proxyRequest(request, params, 'PUT');
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  return proxyRequest(request, params, 'DELETE');
}
