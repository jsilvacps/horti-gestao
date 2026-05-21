import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: NextRequest) {
  try {
    const { empresa_id } = await req.json();
    if (!empresa_id) return NextResponse.json({ ok: false });

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL  ?? "",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    );

    const { error } = await supabase
      .from("clientes_licenciados")
      .update({ ultimo_acesso: new Date().toISOString() })
      .eq("empresa_id", empresa_id);

    if (error) {
      console.error("[ping] erro:", error.message);
      return NextResponse.json({ ok: false, error: error.message });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[ping] inesperado:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
