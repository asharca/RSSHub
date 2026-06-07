import { load } from 'cheerio';

import { config } from '@/config';
import ConfigNotFoundError from '@/errors/types/config-not-found';
import InvalidParameterError from '@/errors/types/invalid-parameter';
import type { Route } from '@/types';
import { ViewType } from '@/types';
import got from '@/utils/got';

const ASSETS_REPO = 'asharca/rss-assets';
const ASSETS_BRANCH = 'main';

function formatCount(n: number): string {
    if (n >= 1000) {
        return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    }
    return String(n);
}

function escSvg(s: string): string {
    return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function escHtml(s: string): string {
    return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

interface Repo {
    nameWithOwner: string;
    owner: string;
    name: string;
    description: string | null;
    lang: string | null;
    stars: number;
    forks: number;
    periodStars: number;
}

function truncate(s: string, max: number): string {
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function getDateLabel(since: string, now: Date): string {
    if (since === 'daily') {
        return now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    }
    if (since === 'monthly') {
        return now.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    }
    // weekly: Mon–Sun range
    const day = now.getUTCDay() || 7;
    const monday = new Date(now);
    monday.setUTCDate(now.getUTCDate() - day + 1);
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    return `${fmt(monday)} – ${fmt(sunday)}, ${monday.getUTCFullYear()}`;
}

function buildSvg(repos: Repo[], since: string, language: string, now: Date): string {
    const W = 800;
    const ROW_H = 32;
    const TITLE_H = 64;
    const PAD = 20;
    const LABEL_W = 230;
    const BAR_X = LABEL_W + PAD * 2; // 270
    const COUNT_X = W - PAD; // 780 — count text right edge
    const COUNT_AREA = 52; // reserved for "+5.2k" at 12px
    const BAR_MAX_W = COUNT_X - COUNT_AREA - BAR_X - 8; // gap of 8px between bar and count
    const MAX_NAME_CHARS = 30;

    const maxPeriodStars = Math.max(...repos.map((r) => r.periodStars), 1);
    const totalH = TITLE_H + repos.length * ROW_H + 12;
    const label = language === 'any' || !language ? 'All Languages' : language;
    const gainHeader = since === 'daily' ? 'Today' : since === 'weekly' ? 'This week' : 'This month';
    const dateLabel = getDateLabel(since, now);

    const rows = repos
        .map((repo, i) => {
            const y = TITLE_H + i * ROW_H;
            const barW = Math.max(4, Math.round((repo.periodStars / maxPeriodStars) * BAR_MAX_W));
            const barColor = i === 0 ? '#2da44e' : i === 1 ? '#3fb950' : i === 2 ? '#56d364' : '#8ac8a0';
            const countText = repo.periodStars > 0 ? `+${formatCount(repo.periodStars)}` : '0';
            const name = truncate(repo.nameWithOwner, MAX_NAME_CHARS);

            return `
<text x="${LABEL_W + PAD}" y="${y + 21}" text-anchor="end" fill="#24292f" font-size="13" font-weight="500">${escSvg(name)}</text>
<rect x="${BAR_X}" y="${y + 8}" width="${barW}" height="16" fill="${barColor}" rx="3"/>
<text x="${COUNT_X}" y="${y + 21}" text-anchor="end" fill="#1a7f37" font-size="12" font-weight="600">${countText}</text>`;
        })
        .join('');

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${totalH}" font-family="system-ui,-apple-system,sans-serif">
<rect width="${W}" height="${totalH}" fill="#ffffff" rx="8"/>
<rect width="${W}" height="${totalH}" fill="none" stroke="#d0d7de" rx="8"/>
<text x="${PAD}" y="28" font-size="14" font-weight="600" fill="#24292f">GitHub Trending · ${escSvg(gainHeader)} · ${escSvg(label)}</text>
<text x="${PAD}" y="48" font-size="12" fill="#57606a">${escSvg(dateLabel)}</text>
<line x1="${PAD}" y1="${TITLE_H - 8}" x2="${W - PAD}" y2="${TITLE_H - 8}" stroke="#d0d7de" stroke-width="0.5"/>
${rows}
</svg>`;
}

// Upload SVG to rss-assets repo. If a file for today already exists, skip upload and return the URL.
async function uploadOrGetSvgUrl(filePath: string, svgContent: string, token: string): Promise<string> {
    const apiUrl = `https://api.github.com/repos/${ASSETS_REPO}/contents/${filePath}`;
    const rawUrl = `https://raw.githubusercontent.com/${ASSETS_REPO}/${ASSETS_BRANCH}/${filePath}`;
    const headers = { Authorization: `bearer ${token}`, 'User-Agent': 'RSSHub' };

    try {
        await got({ url: apiUrl, headers });
        return rawUrl;
    } catch {
        // 404 → upload
    }

    const content = Buffer.from(svgContent).toString('base64');
    await got({
        method: 'put',
        url: apiUrl,
        headers,
        json: {
            message: `chore: update trending chart ${filePath}`,
            content,
            branch: ASSETS_BRANCH,
        },
    });

    return rawUrl;
}

function buildTextList(repos: Repo[], since: string): string {
    const gainLabel = since === 'daily' ? 'today' : since === 'weekly' ? 'this week' : 'this month';

    const items = repos
        .map((repo) => {
            const repoUrl = `https://github.com/${escHtml(repo.nameWithOwner)}`;
            const gain = repo.periodStars > 0 ? ` · <strong style="color:#1a7f37">↑ ${formatCount(repo.periodStars)} ${gainLabel}</strong>` : '';
            const desc = repo.description ? `<br/><span style="color:#57606a;font-size:13px">${escHtml(repo.description)}</span>` : '';
            return `<li><a href="${repoUrl}"><strong>${escHtml(repo.nameWithOwner)}</strong></a>${gain} · ★ ${formatCount(repo.stars)} · ⑂ ${formatCount(repo.forks)}${repo.lang ? ` · ${escHtml(repo.lang)}` : ''}${desc}</li>`;
        })
        .join('\n');

    return `<ol style="font-family:system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.8;padding-left:20px">\n${items}\n</ol>`;
}

export const route: Route = {
    path: '/trending-chart/:since/:language/:spoken_language?',
    categories: ['programming'],
    example: '/github/trending-chart/weekly/any',
    view: ViewType.Notifications,
    parameters: {
        since: {
            description: 'time range',
            options: [
                { value: 'daily', label: 'Today' },
                { value: 'weekly', label: 'This week' },
                { value: 'monthly', label: 'This month' },
            ],
        },
        language: {
            description: "programming language, use `any` for all. Available in [Trending page](https://github.com/trending)'s URL",
            default: 'any',
        },
        spoken_language: {
            description: "natural language filter, available in [Trending page](https://github.com/trending)'s URL",
        },
    },
    features: {
        requireConfig: [
            {
                name: 'GITHUB_ACCESS_TOKEN',
                description: '',
            },
        ],
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    radar: [
        {
            source: ['github.com/trending'],
            target: '/trending-chart/:since',
        },
    ],
    name: 'Trending Chart',
    maintainers: ['asharca'],
    handler,
    url: 'github.com/trending',
};

async function handler(ctx) {
    if (!config.github?.access_token) {
        throw new ConfigNotFoundError('GitHub trending RSS is disabled due to the lack of <a href="https://docs.rsshub.app/deploy/config#route-specific-configurations">relevant config</a>');
    }

    const since = ctx.req.param('since');
    if (!['daily', 'weekly', 'monthly'].includes(since)) {
        throw new InvalidParameterError(`Invalid since value: ${since}`);
    }
    const rawLanguage = ctx.req.param('language');
    const language = rawLanguage === 'any' ? '' : rawLanguage;
    const spoken_language = ctx.req.param('spoken_language') ?? '';

    const trendingUrl = `https://github.com/trending/${encodeURIComponent(language)}?since=${since}&spoken_language_code=${spoken_language}`;
    const { data: trendingPage } = await got({ method: 'get', url: trendingUrl, headers: { Referer: trendingUrl } });
    const $ = load(trendingPage);

    const trendingRepos = $('article')
        .toArray()
        .map((item) => {
            const [owner, name] = $(item).find('h2').text().split('/');
            const articleText = $(item).text();
            const match = articleText.match(/(\d[\d,]*)\s+stars?\s+(?:this\s+week|this\s+month|today)/i);
            const periodStars = match ? Number.parseInt(match[1].replaceAll(',', ''), 10) : 0;
            return { owner: owner.trim(), name: name.trim(), periodStars };
        })
        .filter(({ owner, name }) => /^[\w.-]+$/.test(owner) && /^[\w.-]+$/.test(name));

    const { data: repoData } = await got({
        method: 'post',
        url: 'https://api.github.com/graphql',
        headers: { Authorization: `bearer ${config.github.access_token}` },
        json: {
            query: /* GraphQL */ `
            query {
            ${trendingRepos
                .map(
                    (repo, i) => `
                _${i}: repository(owner: "${repo.owner}", name: "${repo.name}") {
                    nameWithOwner
                    description
                    stargazerCount
                    forkCount
                    primaryLanguage { name }
                }
            `
                )
                .join('')}
            }`,
        },
    });

    const repos: Repo[] = trendingRepos
        .map(({ periodStars }, i) => {
            const r = repoData.data[`_${i}`] as any;
            return {
                nameWithOwner: r.nameWithOwner,
                owner: r.nameWithOwner.split('/')[0],
                name: r.nameWithOwner.split('/')[1],
                description: r.description ?? null,
                lang: r.primaryLanguage?.name ?? null,
                stars: r.stargazerCount,
                forks: r.forkCount,
                periodStars,
            };
        })
        .toSorted((a, b) => b.periodStars - a.periodStars);

    const now = new Date();
    const periodKey = now.toISOString().slice(0, 10);

    const svg = buildSvg(repos, since, rawLanguage, now);
    const langSlug = rawLanguage.replaceAll(/[^a-z0-9-]/gi, '_');
    const filePath = `trending-chart/${since}-${langSlug}-${spoken_language || 'any'}-${periodKey}.svg`;
    const imageUrl = await uploadOrGetSvgUrl(filePath, svg, config.github.access_token);

    const label = rawLanguage === 'any' ? 'All Languages' : rawLanguage;
    const title = `GitHub Trending Chart · ${since} · ${label}`;
    const guid = `github-trending-chart-${since}-${rawLanguage}-${spoken_language}-${periodKey}`;
    const textList = buildTextList(repos, since);
    const description = `<img src="${imageUrl}" alt="${escHtml(title)}" style="max-width:100%"/>\n${textList}`;

    return {
        title,
        link: trendingUrl,
        item: [
            {
                guid,
                title,
                description,
                pubDate: now,
                link: trendingUrl,
            },
        ],
    };
}
