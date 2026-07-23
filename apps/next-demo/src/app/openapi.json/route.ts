import { NextResponse } from 'next/server';
import { openApiSpec } from '../../lib/openApi';

export const GET = () => NextResponse.json(openApiSpec('json'));
