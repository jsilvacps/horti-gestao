import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";

const resend = new Resend(process.env.RESEND_API_KEY);
const DESTINATARIO = "jeansilva3323@gmail.com";

// Client direto (sem filtro empresa_id) para tabela global de suporte
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL  ?? "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
);

const assuntoLabel: Record<string, string> = {
  duvida:   "Dúvida técnica",
  erro:     "Erro no sistema",
  sugestao: "Sugestão de melhoria",
  outro:    "Outro assunto",
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { nome, estabelecimento, whatsapp, assunto, mensagem, empresa_id } = body;

    if (!nome || !mensagem || !assunto) {
      return NextResponse.json({ error: "Campos obrigatórios faltando." }, { status: 400 });
    }

    // 1. Salva no banco
    const { error: dbError } = await supabaseAdmin
      .from("suporte_solicitacoes")
      .insert([{ nome, estabelecimento, whatsapp, assunto, mensagem, empresa_id: empresa_id ?? null, status: "aberto" }]);

    if (dbError) console.error("[suporte] DB error:", dbError.message);

    // 2. Envia email (não bloqueia se falhar)
    try {
      await resend.emails.send({
        from:    "Horti Gestão Suporte <onboarding@resend.dev>",
        to:      [DESTINATARIO],
        subject: `[Suporte] ${assuntoLabel[assunto] ?? assunto} — ${estabelecimento || nome}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#f9fafb;border-radius:12px">
            <div style="background:#16a34a;color:#fff;padding:16px 24px;border-radius:8px 8px 0 0">
              <h2 style="margin:0;font-size:20px">📬 Nova solicitação de suporte</h2>
            </div>
            <div style="background:#fff;padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px">
              <table style="width:100%;border-collapse:collapse;font-size:14px">
                <tr style="border-bottom:1px solid #f3f4f6">
                  <td style="padding:10px 0;color:#6b7280;width:160px;font-weight:600">Nome</td>
                  <td style="padding:10px 0;color:#111827;font-weight:700">${nome}</td>
                </tr>
                <tr style="border-bottom:1px solid #f3f4f6">
                  <td style="padding:10px 0;color:#6b7280;font-weight:600">Estabelecimento</td>
                  <td style="padding:10px 0;color:#111827">${estabelecimento || "—"}</td>
                </tr>
                <tr style="border-bottom:1px solid #f3f4f6">
                  <td style="padding:10px 0;color:#6b7280;font-weight:600">WhatsApp</td>
                  <td style="padding:10px 0">
                    ${whatsapp ? `<a href="https://wa.me/55${whatsapp.replace(/\D/g,"")}" style="color:#16a34a;font-weight:700">${whatsapp}</a>` : "—"}
                  </td>
                </tr>
                <tr style="border-bottom:1px solid #f3f4f6">
                  <td style="padding:10px 0;color:#6b7280;font-weight:600">Assunto</td>
                  <td style="padding:10px 0;color:#111827;font-weight:700">${assuntoLabel[assunto] ?? assunto}</td>
                </tr>
              </table>
              <div style="margin-top:20px">
                <div style="color:#6b7280;font-size:13px;font-weight:600;margin-bottom:8px">MENSAGEM</div>
                <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;color:#111827;font-size:15px;line-height:1.7;white-space:pre-wrap">${mensagem}</div>
              </div>
              ${whatsapp ? `
              <div style="margin-top:20px;text-align:center">
                <a href="https://wa.me/55${whatsapp.replace(/\D/g,"")}" style="display:inline-block;background:#16a34a;color:#fff;font-weight:700;font-size:15px;padding:12px 28px;border-radius:8px;text-decoration:none">
                  💬 Responder via WhatsApp
                </a>
              </div>` : ""}
            </div>
            <div style="text-align:center;color:#9ca3af;font-size:12px;margin-top:16px">
              Horti Gestão PDV · ${new Date().toLocaleString("pt-BR")}
            </div>
          </div>
        `,
      });
    } catch (emailErr) {
      console.error("[suporte] Email error:", emailErr);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[suporte] Erro inesperado:", err);
    return NextResponse.json({ error: "Erro interno." }, { status: 500 });
  }
}
