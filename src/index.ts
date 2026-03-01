import * as core from '@actions/core';
import * as github from '@actions/github';
import OpenAI from 'openai';
import { buildSystemPrompt, type Intensity } from './prompts.js';

interface ReviewComment {
	path: string;
	line: number;
	body: string;
	severity: 'critical' | 'warning' | 'suggestion' | 'nitpick';
}

interface ReviewResponse {
	summary: string;
	verdict: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
	comments: ReviewComment[];
}

const SEVERITY_EMOJI: Record<string, string> = {
	critical: '🔴',
	warning: '🟡',
	suggestion: '🔵',
	nitpick: '⚪',
};

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

		core.info(`🔍 Reviewing PR #${prNumber} (intensity: ${intensity}, model: ${model})`);

		// Get PR diff
		const { data: diff } = await octokit.rest.pulls.get({
			owner,
			repo,
			pull_number: prNumber,
			mediaType: { format: 'diff' },
		});

		const diffText = diff as unknown as string;

		if (!diffText || diffText.length === 0) {
			core.info('Geen changes, skip review');
			return;
		}

		// Truncate large diffs
		const maxDiffChars = 60_000;
		const truncatedDiff =
			diffText.length > maxDiffChars
				? `${diffText.substring(0, maxDiffChars)}\n\n... (diff afgekapt — ${diffText.length} chars totaal)`
				: diffText;

		// Get PR metadata
		const { data: pr } = await octokit.rest.pulls.get({
			owner,
			repo,
			pull_number: prNumber,
		});

		// Get changed files for context
		const { data: files } = await octokit.rest.pulls.listFiles({
			owner,
			repo,
			pull_number: prNumber,
		});

		const filesSummary = files
			.map((f) => `${f.status} ${f.filename} (+${f.additions}/-${f.deletions})`)
			.join('\n');

		const userPrompt = `PR #${prNumber}: ${pr.title}
${pr.body ? `\nBeschrijving:\n${pr.body}\n` : ''}
Gewijzigde bestanden:
${filesSummary}

Diff:
\`\`\`diff
${truncatedDiff}
\`\`\``;

		// LLM review
		const openai = new OpenAI({ apiKey: openaiKey });
		const completion = await openai.chat.completions.create({
			model,
			messages: [
				{ role: 'system', content: buildSystemPrompt(intensity) },
				{ role: 'user', content: userPrompt },
			],
			temperature: 0.7,
			response_format: { type: 'json_object' },
		});

		const content = completion.choices[0]?.message?.content;
		if (!content) {
			core.setFailed('Geen response van LLM');
			return;
		}

		let review: ReviewResponse;
		try {
			review = JSON.parse(content);
		} catch {
			core.setFailed(`Ongeldige JSON response: ${content.substring(0, 200)}`);
			return;
		}

		core.info(`Verdict: ${review.verdict} | Comments: ${review.comments.length}`);

		// Validate comment paths against actual changed files
		const changedFiles = new Set(files.map((f) => f.filename));
		const validComments = review.comments.filter((c) => {
			if (!changedFiles.has(c.path)) {
				core.warning(`Skip comment voor ${c.path} — niet in diff`);
				return false;
			}
			return true;
		});

		// Build review body with severity stats
		const severityCounts = validComments.reduce(
			(acc, c) => {
				acc[c.severity] = (acc[c.severity] || 0) + 1;
				return acc;
			},
			{} as Record<string, number>,
		);

		const statsLine = Object.entries(severityCounts)
			.map(([s, n]) => `${SEVERITY_EMOJI[s] || '❓'} ${n} ${s}`)
			.join(' · ');

		const reviewBody = [
			`## 🤬 Scheldbot Review`,
			`> intensity: \`${intensity}\` · model: \`${model}\`${statsLine ? ` · ${statsLine}` : ''}`,
			'',
			review.summary,
		].join('\n');

		// Submit review with inline comments where possible
		const reviewComments = validComments.map((c) => ({
			path: c.path,
			line: c.line,
			body: `${SEVERITY_EMOJI[c.severity] || ''} ${c.body}`,
		}));

		// GitHub API: create review with comments in one call
		try {
			await octokit.rest.pulls.createReview({
				owner,
				repo,
				pull_number: prNumber,
				commit_id: pr.head.sha,
				event: review.verdict,
				body: reviewBody,
				comments: reviewComments,
			});
			core.info('✅ Review met inline comments geplaatst');
		} catch (err) {
			// Fallback: some comments might fail if line is not in diff hunk
			// Submit review without inline comments, then try individual comments
			core.warning(`Batch review failed, trying fallback: ${err}`);

			await octokit.rest.pulls.createReview({
				owner,
				repo,
				pull_number: prNumber,
				event: review.verdict,
				body: reviewBody,
			});

			for (const comment of validComments) {
				try {
					await octokit.rest.pulls.createReviewComment({
						owner,
						repo,
						pull_number: prNumber,
						body: `${SEVERITY_EMOJI[comment.severity] || ''} ${comment.body}`,
						path: comment.path,
						line: comment.line,
						commit_id: pr.head.sha,
					});
				} catch {
					core.warning(`Skip inline comment ${comment.path}:${comment.line}`);
				}
			}
			core.info('✅ Review geplaatst (fallback mode)');
		}
	} catch (error) {
		if (error instanceof Error) core.setFailed(error.message);
	}
}

run();
