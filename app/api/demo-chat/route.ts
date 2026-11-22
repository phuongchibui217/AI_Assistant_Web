import { localeToSupportedLang } from "@/lib/lang-detect";
import { classifyQueryLocal, generateDemoChitchat, generateDemoSuggestions, searchDemoKnowledgeBase } from "@/lib/server/demo-chat";

export async function POST(req: Request): Promise<Response> {
  const payload: { query?: unknown; locale?: unknown; gender?: unknown } | null = await req.json().catch(() => null);
  const query = typeof payload?.query === "string" ? payload.query.trim() : "";
  if (!query) return Response.json({ error: "Missing question" }, { status: 400 });

  const lang = (typeof payload?.locale === "string" ? localeToSupportedLang(payload.locale) : null) ?? "en";
  const gender = payload?.gender === "male" ? "male" : "female";
  if (classifyQueryLocal(query) === "CHAT") {
    return Response.json({ answer: generateDemoChitchat(query, lang, gender), answerLang: lang, citations: [] });
  }

  return Response.json({ ...searchDemoKnowledgeBase(query, lang), suggestions: generateDemoSuggestions(lang) });
}
