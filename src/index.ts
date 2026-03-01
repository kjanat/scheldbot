import * as core from '@actions/core';
import * as github from '@actions/github';
import OpenAI from 'openai';
import { buildSystemPrompt, type Intensity } from './prompts.js';

interface ReviewComment {
	path: string;
	line: number;
	body: string;
}

interface ReviewResponse {
	summary: string;
	verdict: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
	comments: ReviewComment[];
}

async function run(): Promise<void> {
	try {
		const token = core.getInput('github-token', { required: true });
		const openaiKey = core.getInput('openai-api-key', { required: true });
		const intensity = core.getInput('intensity') as Intensity;
		const model = core.getInput('model') || 'gpt-4o-mini';

		if (!['low', 'medium', 'high', 'kanker'].includes(intensity)) {
			core.setFailed(`Ongeldige intensity: ${intensity}`);
			return;
		}

		const octokit = github.getOctokit(token);
		const ctx = github.context;

		if (!ctx.payload.pull_request) {
			core.setFailed('Deze action werkt alleen op pull_request events');
			return;
		}

		const prNumber = ctx.payload.pull_request.number;
		const { owner, repo } = ctx.repo;

		core.info(`Reviewing PR #${prNumber} met intensity: ${intensity}`);

		// Get the PR diff
		const { data: diff } = await octokit.rest.pulls.get({
			owner,
			repo,
			pull_number: prNumber,
			mediaType: { format: 'diff' },
		});

		const diffText = diff as unknown as string;

		if (!diffText || diffText.length === 0) {
			core.info('Geen changes gevonden, skip review');
			return;
		}

		// Truncate diff if too large (token limits)
		const maxDiffChars = 60_000;
		const truncatedDiff =
			diffText.length > maxDiffChars
				? `${diffText.substring(0, maxDiffChars)}\n\n... (diff afgekapt, te groot voor review)`
				: diffText;

		// Get PR info for context
		const { data: pr } = await octokit.rest.pulls.get({
			owner,
			repo,
			pull_number: prNumber,
		});

		const userPrompt = `PR #${prNumber}: ${pr.title}

${pr.body ? `Beschrijving: ${pr.body}\n\n` : ''}Diff:
\`\`\`diff
${truncatedDiff}
\`\`\``;

		// Call LLM
		const openai = new OpenAI({ apiKey: openaiKey });
		const completion = await openai.chat.completions.create({
			model,
			messages: [
				{ role: 'system', content: buildSystemPrompt(intensity) },
				{ role: 'user', content: userPrompt },
			],
			temperature: 0.9,
			response_format: { type: 'json_object' },
		});

		const content = completion.choices[0]?.message?.content;
		if (!content) {
			core.setFailed('Geen response van LLM');
			return;
		}

		const review: ReviewResponse = JSON.parse(content);

		core.info(`Verdict: ${review.verdict}`);
		core.info(`Comments: ${review.comments.length}`);

		// Get the list of changed files to validate comment paths
		const { data: files } = await octokit.rest.pulls.listFiles({
			owner,
			repo,
			pull_number: prNumber,
		});

		const changedFiles = new Set(files.map((f) => f.filename));

		// Filter comments to only valid files and lines within the diff
		const validComments = review.comments.filter((c) => {
			if (!changedFiles.has(c.path)) {
				core.warning(`Skipping comment for ${c.path} — niet in de diff`);
				return false;
			}
			return true;
		});

		// Map verdict to GitHub review event
		const eventMap: Record<string, 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'> = {
			APPROVE: 'APPROVE',
			REQUEST_CHANGES: 'REQUEST_CHANGES',
			COMMENT: 'COMMENT',
		};

		// Submit review
		// Use individual comments instead of review comments to avoid
		// "pull_request_review_thread.line must be part of the diff" errors
		await octokit.rest.pulls.createReview({
			owner,
			repo,
			pull_number: prNumber,
			event: eventMap[review.verdict] ?? 'COMMENT',
			body: `🤬 **Scheldbot Review** (intensity: \`${intensity}\`)\n\n${review.summary}`,
		});

		// Post individual comments for specific lines
		for (const comment of validComments) {
			try {
				await octokit.rest.pulls.createReviewComment({
					owner,
					repo,
					pull_number: prNumber,
					body: comment.body,
					path: comment.path,
					line: comment.line,
					commit_id: pr.head.sha,
				});
			} catch (err) {
				// Line might not be in the diff hunk — post as issue comment instead
				core.warning(
					`Kon geen inline comment plaatsen op ${comment.path}:${comment.line}, skip: ${err}`,
				);
			}
		}

		core.info('Review geplaatst! 🤬');
	} catch (error) {
		if (error instanceof Error) core.setFailed(error.message);
	}
}

run();
