# Self Updating Studio

A self-contained web page plus a Node.js agent that proposes one AI redesign at a time through GitHub pull requests.

## Setup

1. Create a GitHub repository and push this folder to it.
2. Copy `.env.example` to `.env` and fill in `GROQ_API_KEY`, `GITHUB_TOKEN`, `REPO_OWNER`, and `REPO_NAME`.
3. Install dependencies with `npm.cmd install`.
4. Run the local validator with `npm.cmd run validate`.
5. Start the agent with `npm.cmd run agent`.

The agent pulls `main`, creates a timestamped branch, generates a complete replacement for `selfUpdatingWeb.html`, rebases, pushes, creates a PR, and waits for GitHub checks. Set `AUTO_MERGE=true` only after branch protection and CI are configured as intended.

## Deployment

Connect the GitHub repository to Vercel or Netlify and set `main` as the production branch. A merge to `main` then triggers the platform's normal deployment webhook. The Vercel variables are included for future API-based deployment work, but the GitHub integration is the preferred deployment path here.

## Operational notes

The one-minute interval is intentionally configurable and can create up to 1,440 PR attempts per day. Watch Groq, GitHub, and deployment quotas. The worker serializes cycles so a slow check cannot overlap the next Git operation.
