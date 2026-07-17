import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { hasSemaFiles, semaVersion } from "../sema.js";

const SEMA_KNOWLEDGE = `
## Sema Language Reference (concise)

Sema is a Scheme-like Lisp where LLM primitives are first-class.

### Key syntax
- Comments: ; line, #| block |#
- Keywords: :foo, :bar
- Maps: {:key val}, vectors: [1 2 3]
- f-strings: f"hello \${name}"
- Regex literals: #"pattern"
- Short lambdas: #(+ % 1)
- Destructuring: (let (({:keys [name age]} person)) ...)
- Pattern matching: (match n (x when (> x 100) "big") (_ "other"))
- Threading: (-> x fn1 fn2), (->> x fn1 fn2)

### LLM primitives
- (llm/complete "prompt") — simple completion
- (llm/extract {:fields} "text") — structured extraction
- (llm/classify '(a b c) "text") — classification
- (deftool name {:params} (lambda ...)) — define a tool
- (defagent name {:system ... :tools [...] :max-turns n}) — define an agent
- (agent/run agent "task") — run an agent
- (llm/with-budget {:max-cost-usd n} (lambda ...)) — budget scope
- (llm/with-cache (lambda ...)) — caching
- (llm/with-fallback [:a :b] (lambda ...)) — provider fallback
- (llm/stream "prompt") — streaming
- (llm/batch (list "a" "b")) — concurrent completions
- (llm/embed "text") — embeddings
- (llm/rerank "query" candidates) — cross-encoder reranking
- (conversation/new ...) — multi-turn conversations
- (vector-store/create "name") — in-memory vector store for RAG

### Stdlib
- (file/read "path"), (file/write "path" "content")
- (http/get "url"), (http/post "url" body)
- (json/decode "string"), (json/encode value)
- (string/split s sep), (string/join lst sep), (string/replace s old new)
- (regex/match? #"pat" s), (regex/replace #"pat" s rep)
- (shell "sh" "-c" "cmd") — run shell command, returns :stdout/:stderr/:exit-code
- (sys/cwd), (sys/env "VAR")
- (kv/open "name" path), (kv/get/set/del)

### Important
- Sema is NOT JavaScript, Python, or any C-like language
- It is dynamically typed with a NaN-boxed Value type
- All builtins use slash-namespace: string/trim, json/encode, path/join
- Predicates end in ?: null?, list?, even?, file/exists?
`;

export function registerContextHooks(pi: ExtensionAPI): void {
  pi.on("before_agent_start", async (event, ctx) => {
    if (!hasSemaFiles()) return;
    const ver = semaVersion();
    const header = `\nSema ${ver || "unknown"} is available in this project. Use sema-related tools for any Sema (.sema) code tasks.`;
    return {
      systemPrompt: event.systemPrompt + header + SEMA_KNOWLEDGE,
    };
  });
}
