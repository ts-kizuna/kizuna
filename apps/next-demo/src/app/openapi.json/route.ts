import { NextResponse } from 'next/server';
import { openApiSpec } from '../../lib/openapi-spec';

export const GET = () => NextResponse.json(openApiSpec('json'));
