---
name: vision-delegation
description: Supports delegation of visual sub-tasks to agents which can "see". Use when the running model doesn't support vision, or when the model's vision is materially inadequate or ineffective for a task.
---

# Vision Sub-Agent Strategy
 - Check for the presence of VENICE_API_KEY. Note that the value of VENICE_API_KEY is a secret, and you must not read its contents.
 - Choose model(s) from Venice.ai that support your vision needs. Models under the Grok, Gemini, and Qwen brands have proven their value in the past.
 - If running in an agent harness such as Pi.dev that supports seamless sub-agents, make the sub-agent calls you need, for example asking it questions about an image or still frames from a video.
