I need a Cloudflare worker with the following API (no HTML):

- Has oauth with https://x.stripeflare.com
  - CLIENT_ID: flaredream.com
  - x username : janwilmake
- Also has cloudflare oauth using https://cloudflare.simplerauth.com
- Stores user in user-centric DO with both all info from the user from stripeflare, as well as the cloudflare credentials.
- The user-DO also has a table `runs` that contain `{ run_id (PK), user_id, worker_id TEXT, prompt_url, deploy_result }`
- Has an API '/agent?prompt={prompt}[&worker_id={id}]' that
  - if hit unauthenticated redirects to the stripeflare login first
  - if balance <0.2, payment required, redirect to `/pricing`
  - otherwise, hit openai `/chat/completions` first with system prompt from `env.ASSETS.fetch(url.origin+'/system.md')` first and the prompt. the response should have a `x-result-url` header which should be inserted as a run as prompt_url.
- Has an api `/deploy/{run_id}` which is a tool that tries to deploy

NOTE TO SELF:

- the deploy api that also inserts

# GOAL: Ultimate Constraint satisfaction loop:

Problem: It generates apps that have errors, but it can sometimes be hard to see the error.

With Natural language Spec, I need an agent that does this in freeform with a provided budget. It should be a `run` on lmpify:

Starting tool: `generate(spec,feedback)` should generate the worker and also deploy, and set `test` ID if available. Force tool use initially, do not allow again.

The main loop is a while loop that runs:

- **Code Agent** with context 'spec,feedback'

  - With the spec and feedback thus far, perform AI Codegen
  - Deploy afterwards (an after-tool): `deploy.flaredream.com/download.flaredream.com/id`

- **Test agent** with context 'spec,feedback[,deployError]' and tools

  - `test(request,criteria)=>response=>feedback` will allow free-form tests against the tailworker without bloating context
  - `final_feedback(feedback, replace_feedback:boolean, status: "ok"|"fail"|"retry")` will end the agent

- If reset has been hit >n times but no `stop:true` stop

Important to note: code agent doesn't get entire test-agents context, the test-agent test-tool is in itself also agentic.

This is the dream and I'm just one agent-framework away! [BELIEVE THAT I CAN DO THIS IN FEW HOURS]
