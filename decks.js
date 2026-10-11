// Static cards (code and text): SQL, Python, dbt and Git snippets, communication,
// engineering & MLOps, plus code and tips for EDA, time series and graphs.
// Added to the galleries in charts.js by category via addTypes.

const CODE = [
  // ---- SQL ----
  {
    lang: 'sql', name: 'Running total', family: 'Window functions',
    code: `SELECT order_date,
       amount,
       SUM(amount) OVER (
         ORDER BY order_date
       ) AS running_total
FROM orders;`,
    tip: 'A window function adds a running total to every row without collapsing rows the way GROUP BY would.',
  },
  {
    lang: 'sql', name: 'Latest row per key', family: 'QUALIFY',
    url: 'https://docs.snowflake.com/en/sql-reference/constructs/qualify',
    code: `SELECT *
FROM customer_events
QUALIFY ROW_NUMBER() OVER (
  PARTITION BY customer_id
  ORDER BY event_ts DESC
) = 1;`,
    tip: 'QUALIFY filters on a window function directly, with no subquery. The standard way to deduplicate to the latest record.',
  },
  {
    lang: 'sql', name: 'Top N per group', family: 'QUALIFY',
    url: 'https://docs.snowflake.com/en/sql-reference/constructs/qualify',
    code: `SELECT category, product, sales
FROM product_sales
QUALIFY RANK() OVER (
  PARTITION BY category
  ORDER BY sales DESC
) <= 3;`,
    tip: 'Top 3 products in every category. RANK keeps ties; ROW_NUMBER would break them arbitrarily.',
  },
  {
    lang: 'sql', name: 'Readable queries with CTEs', family: 'Style',
    code: `WITH active AS (
  SELECT id FROM users
  WHERE last_seen >= '2026-01-01'
), spend AS (
  SELECT user_id, SUM(amount) s
  FROM orders GROUP BY 1
)
SELECT AVG(s) FROM active
JOIN spend ON user_id = id;`,
    tip: 'Name each step. CTEs read top to bottom like a recipe and are far easier to debug than nested subqueries.',
  },
  {
    lang: 'sql', name: 'Period-over-period change', family: 'Window functions',
    code: `SELECT month,
       revenue,
       revenue - LAG(revenue)
         OVER (ORDER BY month)
         AS change
FROM monthly_revenue;`,
    tip: 'LAG looks back one row and LEAD looks forward. Ideal for month-over-month and year-over-year deltas.',
  },
  {
    lang: 'sql', name: 'Moving average', family: 'Window functions',
    code: `SELECT day, sales,
  AVG(sales) OVER (
    ORDER BY day
    ROWS BETWEEN 6 PRECEDING
         AND CURRENT ROW
  ) AS ma_7d
FROM daily_sales;`,
    tip: 'A 7-day moving average. ROWS counts physical rows, so fill in missing days first (see date spine) or the window stretches.',
  },
  {
    lang: 'sql', name: 'The NOT IN + NULL trap', family: 'Gotchas',
    code: `-- Empty if any user_id is NULL:
WHERE id NOT IN
  (SELECT user_id FROM churned)

-- Safe:
WHERE NOT EXISTS (
  SELECT 1 FROM churned c
  WHERE c.user_id = u.id)`,
    tip: 'x NOT IN (…, NULL) is never true, so a single NULL silently empties the result. NOT EXISTS behaves as you expect.',
  },
  {
    lang: 'sql', name: 'The LEFT JOIN that became INNER', family: 'Gotchas',
    code: `SELECT u.id, o.amount
FROM users u
LEFT JOIN orders o
  ON o.user_id = u.id
 AND o.status = 'paid'  -- ✓
-- WHERE o.status = 'paid'
-- drops users without
-- orders ✗`,
    tip: 'Filtering the right-hand table in WHERE throws away the NULL rows the LEFT JOIN kept. Put that condition in ON.',
  },
  {
    lang: 'sql', name: 'Join fan-out', family: 'Gotchas',
    code: `-- ✗ each order's amount is
--   counted once per item
SELECT SUM(o.amount)
FROM orders o
JOIN order_items i
  ON i.order_id = o.id;`,
    tip: 'Joining one-to-many before aggregating duplicates the “one” side. Aggregate first, and compare row counts before and after every join.',
  },
  {
    lang: 'sql', name: 'Safe division', family: 'Gotchas',
    code: `SELECT campaign,
  clicks
  / NULLIF(impressions, 0)
    AS ctr
FROM ads;`,
    tip: 'NULLIF turns a zero denominator into NULL, so you get NULL instead of a division-by-zero error. Wrap it in COALESCE if you need a default.',
  },
  {
    lang: 'sql', name: 'Conditional aggregation', family: 'Aggregation',
    code: `SELECT region,
  COUNT_IF(status = 'churned')
    AS churned,
  SUM(IFF(plan = 'pro',
          revenue, 0)) AS pro_rev
FROM customers
GROUP BY region;`,
    tip: 'Several filtered metrics in one pass. COUNT_IF and IFF are Snowflake; elsewhere use SUM(CASE WHEN … THEN 1 END).',
  },
  {
    lang: 'sql', name: 'Median and percentiles', family: 'Aggregation',
    code: `SELECT
  MEDIAN(order_value) AS p50,
  PERCENTILE_CONT(0.9)
    WITHIN GROUP
    (ORDER BY order_value)
    AS p90
FROM orders;`,
    tip: 'Averages hide skew. Report the median and a high percentile for order values, latencies, incomes and the like.',
  },
  {
    lang: 'sql', name: 'GROUP BY ALL', family: 'Snowflake',
    code: `SELECT region,
       DATE_TRUNC('month', ts) m,
       COUNT(*) AS orders
FROM orders
GROUP BY ALL;`,
    tip: 'Groups by every non-aggregated column automatically, so the GROUP BY never falls out of sync when you add a column.',
  },
  {
    lang: 'sql', name: 'Value at the max: MAX_BY', family: 'Snowflake',
    code: `SELECT customer_id,
  MAX_BY(plan, changed_at)
    AS current_plan
FROM plan_changes
GROUP BY customer_id;`,
    tip: 'Returns the plan from the row with the latest changed_at, with no self-join or window function.',
  },
  {
    lang: 'sql', name: 'Query JSON with FLATTEN', family: 'Snowflake',
    url: 'https://docs.snowflake.com/en/sql-reference/functions/flatten',
    code: `SELECT e.payload:user_id::int
         AS user_id,
       f.value:sku::string AS sku
FROM events e,
  LATERAL FLATTEN(
    input => e.payload:items) f;`,
    tip: 'The colon path syntax reads semi-structured VARIANT data, and FLATTEN turns a JSON array into one row per element.',
  },
  {
    lang: 'sql', name: 'Time travel', family: 'Snowflake',
    url: 'https://docs.snowflake.com/en/user-guide/data-time-travel',
    code: `-- The table as it was 1 hour ago
SELECT *
FROM orders
  AT(OFFSET => -3600);

-- Dropped it by mistake?
UNDROP TABLE orders;`,
    tip: 'Snowflake keeps history for the retention period: query old versions to debug a pipeline, or undo an accidental drop.',
  },
  {
    lang: 'sql', name: 'Anti-join', family: 'Joins',
    code: `-- Users who never ordered
SELECT u.*
FROM users u
LEFT JOIN orders o
  ON o.user_id = u.id
WHERE o.user_id IS NULL;`,
    tip: 'LEFT JOIN plus IS NULL keeps only rows without a match: “never purchased”, “no login this month” and similar questions.',
  },
  {
    lang: 'sql', name: 'Cohort retention', family: 'Analytics',
    code: `SELECT DATE_TRUNC('month',
         u.signup_at) AS cohort,
  DATEDIFF('month', u.signup_at,
    a.active_at) AS month_n,
  COUNT(DISTINCT u.id) AS users
FROM users u
JOIN activity a ON a.uid = u.id
GROUP BY ALL;`,
    tip: 'Active users by signup month and months since signup. Divide by month 0 to get the classic retention triangle.',
  },
  {
    lang: 'sql', name: 'Date spine', family: 'Analytics',
    code: `SELECT DATEADD('day',
  ROW_NUMBER() OVER
    (ORDER BY SEQ4()) - 1,
  '2026-01-01'::date) AS day
FROM TABLE(GENERATOR(
  ROWCOUNT => 365));`,
    tip: 'One row per day, gaps included. Left join your metrics onto it so days with no activity show up as 0 instead of disappearing.',
  },
  {
    lang: 'sql', name: 'Fast approximate counts', family: 'Performance',
    code: `SELECT
  APPROX_COUNT_DISTINCT(user_id)
FROM page_views;  -- billions`,
    tip: 'HyperLogLog distinct counts, typically within a couple of percent, for a fraction of the time and memory. Fine for dashboards, not for invoices.',
  },
  {
    lang: 'sql', name: 'Sample while exploring', family: 'Performance',
    code: `SELECT *
FROM events
  SAMPLE (1) SEED (42);
-- ~1% of rows, repeatable`,
    tip: 'Explore on a random sample before running on the full table. The seed makes the sample repeatable.',
  },
  {
    lang: 'sql', name: 'Pivot', family: 'Reshaping',
    code: `SELECT *
FROM monthly_sales
  PIVOT (SUM(amount)
    FOR region IN
      ('North', 'South', 'West'))
ORDER BY month;`,
    tip: 'Turns region values into columns: handy for reports. Keep the long format for analysis and plotting.',
  },

  // ---- Python ----
  {
    lang: 'python', name: 'Named aggregation', family: 'pandas',
    code: `(df.groupby("region")
   .agg(orders=("id", "count"),
        revenue=("amount", "sum"),
        aov=("amount", "mean"))
   .sort_values("revenue",
                ascending=False))`,
    tip: 'Named aggregations give clean column names in one step, with no MultiIndex to flatten afterwards.',
  },
  {
    lang: 'python', name: 'Method chaining', family: 'pandas',
    code: `out = (
  raw
  .query("amount > 0")
  .assign(month=lambda d:
      d.ts.dt.to_period("M"))
  .groupby("month")["amount"]
  .sum()
)`,
    tip: 'Each step reads top to bottom, with no half-finished intermediate DataFrames lying around.',
  },
  {
    lang: 'python', name: 'Safer merges', family: 'pandas',
    code: `m = orders.merge(
  customers, on="customer_id",
  how="left",
  validate="many_to_one",
  indicator=True)
m["_merge"].value_counts()`,
    tip: 'validate raises if keys aren’t unique where you assumed they were (no silent fan-out), and indicator shows what didn’t match.',
  },
  {
    lang: 'python', name: 'Shares, not counts', family: 'pandas',
    code: `df["plan"].value_counts(
  normalize=True,
  dropna=False)`,
    tip: 'normalize=True gives proportions, and dropna=False shows how many values are missing instead of hiding them.',
  },
  {
    lang: 'python', name: 'Vectorise, don’t apply', family: 'Performance',
    code: `import numpy as np

df["tier"] = np.select(
  [df.spend > 1000,
   df.spend > 100],
  ["gold", "silver"],
  default="bronze")`,
    tip: 'np.select and np.where work on whole columns at once, often 100× faster than df.apply calling a Python function per row.',
  },
  {
    lang: 'python', name: 'Bin a numeric column', family: 'pandas',
    code: `df["age_band"] = pd.cut(
  df.age,
  bins=[0, 25, 40, 60, 120],
  labels=["<25", "25-39",
          "40-59", "60+"])
pd.qcut(df.income, q=4)`,
    tip: 'cut uses edges you choose; qcut makes equal-sized groups such as quartiles.',
  },
  {
    lang: 'python', name: 'Resample and roll', family: 'pandas',
    code: `daily = (df
  .set_index("ts")
  .resample("D")["sales"]
  .sum())
ma7 = daily.rolling(7).mean()`,
    tip: 'resample groups by calendar period (empty days become 0 for sums), and rolling adds a moving window on top.',
  },
  {
    lang: 'python', name: 'Fix SettingWithCopyWarning', family: 'pandas',
    code: `# ✗ may modify a copy
df[df.x > 0]["y"] = 1

# ✓ one indexing step
df.loc[df.x > 0, "y"] = 1`,
    tip: 'Chained indexing can write to a temporary copy. A single .loc with row and column selectors always writes to the original.',
  },
  {
    lang: 'python', name: 'Explode lists', family: 'pandas',
    code: `# tags: ["a", "b"] in each row
long = df.explode("tags")
long["tags"].value_counts()`,
    tip: 'Turns a column of lists into one row per element, which is far easier to count, join and filter.',
  },
  {
    lang: 'python', name: 'pivot_table', family: 'pandas',
    code: `pd.pivot_table(
  df, index="month",
  columns="region",
  values="sales",
  aggfunc="sum",
  margins=True)`,
    tip: 'A spreadsheet-style summary in one call; margins=True adds row and column totals.',
  },
  {
    lang: 'python', name: 'SQL on DataFrames', family: 'DuckDB',
    code: `import duckdb

duckdb.sql("""
  SELECT region, AVG(amount)
  FROM df
  GROUP BY ALL
""").df()`,
    tip: 'DuckDB runs SQL directly on pandas DataFrames and Parquet files: fast, in-process, and no database server needed.',
  },
  {
    lang: 'python', name: 'Lazy queries', family: 'Polars',
    code: `import polars as pl

(pl.scan_parquet("events/*.pq")
   .filter(pl.col("ok"))
   .group_by("user")
   .agg(pl.len())
   .collect())`,
    tip: 'Polars plans and optimises the whole query before reading anything, so only the columns and rows you need are loaded.',
  },
  {
    lang: 'python', name: 'Read only what you need', family: 'Performance',
    code: `df = pd.read_parquet(
  "events.parquet",
  columns=["user_id", "ts"],
  filters=[("country", "==",
            "NO")])`,
    tip: 'Parquet is columnar: choosing columns and filtering at read time can cut memory use and load time dramatically.',
  },
  {
    lang: 'python', name: 'Category dtype', family: 'Performance',
    code: `df["country"] = (
  df["country"]
  .astype("category"))
df.memory_usage(deep=True)`,
    tip: 'Repeated strings stored as categories take a fraction of the memory and make groupby faster.',
  },
  {
    lang: 'python', name: 'Reproducible randomness', family: 'NumPy',
    code: `rng = np.random.default_rng(42)
sample = rng.normal(0, 1, 1000)
idx = rng.choice(len(df), 100,
                 replace=False)`,
    tip: 'Use a local Generator with a seed instead of the global np.random state, so results are reproducible and independent.',
  },
  {
    lang: 'python', name: 'Pipelines prevent leakage', family: 'scikit-learn',
    code: `pipe = make_pipeline(
  ColumnTransformer([
    ("num", StandardScaler(), num),
    ("cat", OneHotEncoder(), cat),
  ]),
  LogisticRegression())
pipe.fit(X_train, y_train)`,
    tip: 'Preprocessing inside the pipeline is fitted on training folds only, which prevents data leakage during cross-validation.',
  },
  {
    lang: 'python', name: 'Stratified split', family: 'scikit-learn',
    code: `X_tr, X_te, y_tr, y_te = \\
  train_test_split(
    X, y, test_size=0.2,
    stratify=y,
    random_state=42)`,
    tip: 'stratify keeps the class balance identical in train and test, which matters a lot for rare outcomes.',
  },
  {
    lang: 'python', name: 'Cross-validate', family: 'scikit-learn',
    code: `scores = cross_val_score(
  pipe, X, y, cv=5,
  scoring="roc_auc")
print(f"{scores.mean():.3f}"
      f" ± {scores.std():.3f}")`,
    tip: 'Report the mean and spread across folds, not the score from one lucky split.',
  },
  {
    lang: 'python', name: 'Regression with formulas', family: 'statsmodels',
    code: `import statsmodels.formula.api \\
  as smf

m = smf.ols(
  "sales ~ price + C(region)",
  data=df).fit()
print(m.summary())`,
    tip: 'R-style formulas handle categorical variables with C(); summary() gives coefficients, standard errors and confidence intervals.',
  },
  {
    lang: 'python', name: 'f-string formatting', family: 'Python',
    code: `f"{rate:.1%}"      # 12.3%
f"{revenue:,.0f}"  # 1,234,567
f"{x=}"            # x=42
f"{name:>10}"      # right-align`,
    tip: 'Format numbers for humans right inside the f-string. {x=} is a handy debugging shortcut.',
  },
  {
    lang: 'python', name: 'pathlib over strings', family: 'Python',
    code: `from pathlib import Path

data = Path("data")
for f in data.glob("*.csv"):
  print(f.stem, f.stat().st_size)
out = data / "clean" / "a.pq"`,
    tip: 'Paths as objects: join with /, glob, and read file info, portable across Windows, macOS and Linux.',
  },
  {
    lang: 'python', name: 'Dataclasses for config', family: 'Python',
    code: `from dataclasses import dataclass

@dataclass(frozen=True)
class Config:
  start: str = "2026-01-01"
  min_orders: int = 3

cfg = Config(min_orders=5)`,
    tip: 'Typed, immutable settings with defaults and a readable repr, instead of loose dictionaries passed around.',
  },
  {
    lang: 'python', name: 'Generators for big files', family: 'Python',
    code: `def rows(path):
  with open(path) as f:
    for line in f:
      yield line.rstrip("\\n")

n = sum(1 for _ in rows("big.csv"))`,
    tip: 'yield produces one item at a time, so you can stream through files larger than memory.',
  },
  {
    lang: 'python', name: 'Assert your assumptions', family: 'Data quality',
    code: `assert df["id"].is_unique
assert df["amount"].ge(0).all()
assert df["ts"].notna().all(), \\
  "missing timestamps"`,
    tip: 'Cheap checks that fail loudly when the data changes under you, instead of quietly producing wrong numbers.',
  },
];

const COMM = [
  ['Lead with the answer', 'Storytelling', 'Start with the conclusion, then the evidence. Busy readers may stop after the first sentence.\n✗ “We analysed 14 months of data using…”\n✓ “Churn is up 3 points, driven by the price change.”'],
  ['Chart titles state the takeaway', 'Charts', '✗ “Revenue by month”\n✓ “Revenue recovered to pre-summer levels in October”\nThe reader should get the point without decoding the axes.'],
  ['One chart, one message', 'Charts', 'If a chart needs a paragraph of explanation, it’s doing too much. Split it, or cut whatever doesn’t support the point.'],
  ['Highlight, don’t decorate', 'Charts', 'Make everything grey, then colour only what matters. Remove gridlines, borders, shadows and 3D before adding anything.'],
  ['Sort your bar charts', 'Charts', 'Sort bars by value unless the categories have a natural order such as time or age bands. Alphabetical is almost never the most useful order.'],
  ['Table for lookup, chart for patterns', 'Charts', 'Use a table when people need exact values. Use a chart when the shape, trend or comparison is the message.'],
  ['Answer “so what?”', 'Storytelling', 'For every finding, say what it means and what should happen next.\n✗ “Conversion is 2.1%.”\n✓ “Conversion is 2.1%, below our 3% target. Fixing checkout could add about €400k a year.”'],
  ['Make a recommendation', 'Storytelling', 'Don’t stop at insights. Say what you would do, why, and what would change your mind. People can still disagree, but now there’s something concrete to discuss.'],
  ['Show the baseline', 'Storytelling', 'A number means little on its own.\n✗ “4,200 sign-ups”\n✓ “4,200 sign-ups, 30% more than the same month last year.”'],
  ['Headlines tell the story', 'Storytelling', 'Give each slide a full-sentence headline stating its point, and make the content below prove it. Reading only the headlines should tell the whole story.'],
  ['Have the 30-second version', 'Storytelling', 'Prepare the finding, why it matters and what you recommend in three sentences. You will be asked for it in a hallway or a lift.'],
  ['Start from the decision', 'Stakeholders', 'Before any analysis, ask: “What will you do differently depending on the answer?” If the answer is nothing, the analysis can probably wait.'],
  ['Know your audience', 'Stakeholders', 'Executives want the decision and its risk. Peers want the method. Engineers want definitions. Same analysis, three different write-ups.'],
  ['Pre-wire the key people', 'Stakeholders', 'Share surprising or unwelcome findings one-to-one before the big meeting. Nobody likes being surprised in front of their manager.'],
  ['Ask what would change their mind', 'Stakeholders', 'When someone pushes back, ask what evidence would convince them. It turns a debate into a test you can run together.'],
  ['Translate metrics into impact', 'Numbers', '✗ “AUC improved from 0.81 to 0.86.”\n✓ “We now catch a third more fraud cases, about €200k a year.”'],
  ['Absolute beats relative', 'Numbers', '“Risk doubled” sounds alarming. “From 1 in 10,000 to 2 in 10,000” lets people judge for themselves. Give both.'],
  ['Round for humans', 'Numbers', '✗ 23.4172%\n✓ about 23%\nExtra decimals suggest a precision you don’t have, and they make numbers harder to remember.'],
  ['Say how sure you are, in words', 'Numbers', 'Replace “statistically significant” with plain language.\n✓ “We’re fairly confident the uplift is between 2 and 5%, most likely around 3%.”'],
  ['Define the metric', 'Numbers', '“Active users” can mean five different things. Write down the exact definition, time window and filters, and use them every time.'],
  ['Explain the method in one sentence', 'Writing', 'Put the details in an appendix for those who want them.\n✓ “We compared customers who saw the new page with similar customers who didn’t.”'],
  ['State limitations up front', 'Writing', 'Name the biggest caveat before someone else finds it. It builds trust and stops people from stretching your results further than they go.'],
  ['Write the summary first', 'Writing', 'If you can’t write the three-sentence summary, you don’t yet know what the analysis says. Draft it before you make any slides.'],
  ['Order by importance, not chronology', 'Writing', 'Nobody needs the story of how you cleaned the data. Put what matters most first; the journey belongs in the appendix.'],
  ['Use the reader’s words', 'Writing', 'Say “customers who left” rather than “churned cohort”, and “typical” rather than “median”, unless your audience uses the jargon themselves.'],
].map(([name, family, tip]) => ({ cat: 'comm', name, family, tip }));

// ---- Git and dbt (in the code source) ----
const TOOLS = [
  { tool: 'Git', lang: 'shell', name: 'Undo the last commit', family: 'Fixing mistakes',
    code: `# keep the changes, staged
git reset --soft HEAD~1

# keep the changes, unstaged
git reset HEAD~1`,
    tip: 'Takes back a commit that hasn’t been pushed yet without losing any work. Once it’s pushed and shared, use git revert instead.' },
  { tool: 'Git', lang: 'shell', name: 'Fix the last commit', family: 'Fixing mistakes',
    code: `git add forgotten_file.py
git commit --amend --no-edit

# or just reword the message
git commit --amend -m "New msg"`,
    tip: 'Adds a forgotten file or fixes the message of your latest commit. Only amend commits that haven’t been pushed yet.' },
  { tool: 'Git', lang: 'shell', name: 'Undo a pushed commit safely', family: 'Fixing mistakes',
    code: `git revert a1b2c3d
git push`,
    tip: 'revert creates a new commit that cancels the old one, so shared history isn’t rewritten. Safe on main and on any branch others use.' },
  { tool: 'Git', lang: 'shell', name: 'Recover “lost” work', family: 'Fixing mistakes',
    code: `git reflog
# a1b2c3d HEAD@{2}: commit: ...
git switch -c rescue a1b2c3d`,
    tip: 'The reflog records everywhere HEAD has been, including commits lost to a bad reset or rebase. They stick around for weeks, so you can usually get them back.' },
  { tool: 'Git', lang: 'shell', name: 'Feature branch workflow', family: 'Branching',
    code: `git switch -c feat/churn
# ...work, commit...
git push -u origin feat/churn
# then open a pull request`,
    tip: 'One branch per change keeps main always working and gives every change a review before it lands.' },
  { tool: 'Git', lang: 'shell', name: 'Stay up to date with main', family: 'Branching',
    code: `git fetch origin
git rebase origin/main
# fix conflicts, then:
git rebase --continue
git push --force-with-lease`,
    tip: 'Replays your commits on top of the latest main for a clean history. --force-with-lease refuses to overwrite work someone else pushed.' },
  { tool: 'Git', lang: 'shell', name: 'Stash work in progress', family: 'Everyday',
    code: `git stash push -m "half-done plot"
git switch main  # something else
git switch -
git stash pop`,
    tip: 'Puts uncommitted changes aside so you can switch branches with a clean working tree, then brings them back.' },
  { tool: 'Git', lang: 'shell', name: 'See what changed', family: 'Everyday',
    code: `git status -sb
git diff           # unstaged
git diff --staged  # staged
git log --oneline --graph -15`,
    tip: 'Check what you’re about to commit before every commit. It’s the cheapest bug filter there is.' },
  { tool: 'Git', lang: 'shell', name: 'Find the commit that broke it', family: 'Debugging',
    code: `git bisect start
git bisect bad            # now
git bisect good v1.4      # known ok
# test, then mark good/bad...
git bisect reset`,
    tip: 'Binary search through history: Git checks out the commit halfway between, you test, and in a few steps you find the exact change that broke things.' },
  { tool: 'Git', lang: 'shell', name: 'Who changed this and why?', family: 'Debugging',
    code: `git blame -L 40,60 src/features.py
git log -S "min_orders" --oneline
git show a1b2c3d`,
    tip: 'blame shows the last commit for each line; log -S finds every commit that added or removed a piece of text. Then read the commit message for the why.' },
  { tool: 'Git', lang: 'shell', name: 'A .gitignore for data work', family: 'Setup',
    code: `# .gitignore
data/
*.parquet
*.csv
.env
.ipynb_checkpoints/
__pycache__/
mlruns/`,
    tip: 'Keep data, secrets and generated files out of Git. Repositories are for code and small config; data belongs in the warehouse or object storage.' },
  { tool: 'Git', lang: 'shell', name: 'Notebooks in Git', family: 'Setup',
    code: `pip install nbstripout
nbstripout --install
# or pair notebooks with .py files
jupytext --set-formats \\
  ipynb,py:percent nb.ipynb`,
    tip: 'Notebook outputs make diffs unreadable and can leak data. Strip outputs on commit, or version a paired .py file that diffs cleanly.' },
  { tool: 'Git', lang: 'shell', name: 'Pushed a secret?', family: 'Fixing mistakes',
    code: `# 1. Rotate the key NOW
# 2. Then remove it from the code
git rm --cached .env
echo ".env" >> .gitignore
git commit -m "Remove .env"`,
    tip: 'Deleting the file isn’t enough: the secret stays in history and forks. Revoke and rotate the credential first; cleaning history is secondary.' },
  { tool: 'Git', lang: 'shell', name: 'Write useful commit messages', family: 'Everyday',
    code: `git commit -m "Drop test accounts

They inflated actives by 4%.
See ticket DATA-212."`,
    tip: 'A short summary line in the imperative, then why the change was needed. Your future self reading git log will thank you.' },

  { tool: 'dbt', lang: 'dbt', name: 'A model with ref()', family: 'Models',
    code: `-- models/marts/fct_orders.sql
select
    o.order_id,
    o.customer_id,
    o.amount,
    c.country
from {{ ref('stg_orders') }} o
join {{ ref('dim_customers') }} c
  using (customer_id)`,
    tip: 'ref() wires models together: dbt builds them in dependency order, swaps in the right schema per environment and draws the lineage graph.' },
  { tool: 'dbt', lang: 'dbt', name: 'Staging from sources', family: 'Models',
    code: `-- models/staging/stg_orders.sql
select
    id as order_id,
    customer as customer_id,
    amount_cents / 100.0 as amount,
    created_at::timestamp
      as ordered_at
from {{ source('shop', 'orders') }}`,
    tip: 'Staging models do light cleanup only: rename, cast and convert units, one model per source table. Everything downstream builds on them.' },
  { tool: 'dbt', lang: 'yaml', name: 'Generic tests', family: 'Testing',
    code: `models:
  - name: fct_orders
    columns:
      - name: order_id
        tests: [unique, not_null]
      - name: status
        tests:
          - accepted_values:
              values:
                [paid, refunded]`,
    tip: 'Declare what must be true about the data, and dbt test checks it on every run. Start with unique and not_null on every primary key.' },
  { tool: 'dbt', lang: 'dbt', name: 'A singular test', family: 'Testing',
    code: `-- tests/no_negative_revenue.sql
-- returns rows = test fails
select *
from {{ ref('fct_orders') }}
where amount < 0`,
    tip: 'Any query that returns the bad rows is a test. Write one for each business rule you’d be embarrassed to see broken in a dashboard.' },
  { tool: 'dbt', lang: 'dbt', name: 'Incremental models', family: 'Performance',
    code: `{{ config(
    materialized='incremental',
    unique_key='event_id') }}
select *
from {{ ref('stg_events') }}
{% if is_incremental() %}
where loaded_at > (select
  max(loaded_at) from {{ this }})
{% endif %}`,
    tip: 'Only process new rows on each run instead of rebuilding the whole table. Essential for big event tables; run with --full-refresh when the logic changes.' },
  { tool: 'dbt', lang: 'shell', name: 'Run only what changed', family: 'Workflow',
    code: `# one model
dbt build -s fct_orders
# plus everything upstream
dbt build -s +fct_orders
# plus everything downstream
dbt build -s fct_orders+
# only what your branch changed
dbt build -s state:modified+ \\
  --state prod/`,
    tip: 'Graph selectors build a model with its parents or children. In CI, state:modified+ builds and tests only what your branch changed and everything it affects.' },
  { tool: 'dbt', lang: 'dbt', name: 'Macros', family: 'Jinja',
    code: `{% macro cents_to_nok(col) %}
  round({{ col }} / 100.0, 2)
{% endmacro %}

select {{ cents_to_nok('amount') }}
from {{ ref('stg_payments') }}`,
    tip: 'Macros are reusable SQL snippets. Use them for logic repeated across models, but don’t hide simple SQL behind too much Jinja.' },
  { tool: 'dbt', lang: 'dbt', name: 'Pivot with a Jinja loop', family: 'Jinja',
    code: `select order_id,
{% for m in ['card', 'vipps'] %}
  sum(case when method = '{{ m }}'
      then amount end)
    as {{ m }}_amount
  {{- ',' if not loop.last }}
{% endfor %}
from {{ ref('stg_payments') }}
group by 1`,
    tip: 'Generate repetitive SQL with a loop instead of copy-paste. Compile with dbt compile to see the SQL it actually runs.' },
  { tool: 'dbt', lang: 'yaml', name: 'Source freshness', family: 'Testing',
    code: `sources:
  - name: shop
    loaded_at_field: _loaded_at
    freshness:
      warn_after:
        {count: 6, period: hour}
      error_after:
        {count: 24, period: hour}
    tables:
      - name: orders`,
    tip: 'dbt source freshness alerts you when upstream data stops arriving, before stakeholders notice a dashboard that hasn’t changed since Tuesday.' },
  { tool: 'dbt', lang: 'dbt', name: 'Snapshots for history', family: 'Models',
    code: `{% snapshot customers_snapshot %}
{{ config(
    unique_key='customer_id',
    strategy='check',
    check_cols=['plan','country']) }}
select *
from {{ source('crm', 'customers') }}
{% endsnapshot %}`,
    tip: 'Snapshots keep every version of changing rows (a type 2 slowly changing dimension), so you can answer “what plan was this customer on last March?”.' },
  { tool: 'dbt', lang: 'yaml', name: 'Unit tests for logic', family: 'Testing',
    code: `unit_tests:
  - name: refunds_are_negative
    model: fct_orders
    given:
      - input: ref('stg_orders')
        rows: [{id: 1, amount: 50,
                status: refunded}]
    expect:
      rows: [{id: 1, amount: -50}]`,
    tip: 'Unit tests run a model on small, hand-written inputs and compare against expected output, so tricky logic is tested before it touches real data.' },
  { tool: 'dbt', lang: 'text', name: 'Layer your project', family: 'Structure',
    code: `models/
├── staging/      # rename + cast,
│                 # 1:1 with sources
├── intermediate/ # joins, reusable
│                 # building blocks
└── marts/        # business-ready
    ├── fct_orders.sql
    └── dim_customers.sql`,
    tip: 'Staging cleans, intermediate combines, marts serve. Analysts and BI tools only query marts, so you can refactor below them freely.' },
  { tool: 'dbt', lang: 'yaml', name: 'Document as you go', family: 'Workflow',
    code: `models:
  - name: fct_orders
    description: >
      One row per paid order.
    columns:
      - name: amount
        description: >
          Total in NOK, excl. VAT.`,
    tip: 'Descriptions live next to the code and show up in dbt docs with the lineage graph. State the grain (“one row per…”) for every model.' },
];

// ---- Engineering & MLOps ----
const ENG = [
  { tool: 'Python', lang: 'text', name: 'Project layout', family: 'Structure',
    code: `churn-model/
├── pyproject.toml
├── src/churn/
│   ├── features.py
│   └── train.py
├── tests/
│   └── test_features.py
├── notebooks/   # exploring only
└── data/        # git-ignored`,
    tip: 'Reusable code in a package under src/, tests next to it, notebooks only for exploration. Anyone can clone it, install it and run the tests.' },
  { tool: 'Python', lang: 'python', name: 'Test your data code', family: 'Testing',
    code: `# tests/test_features.py
from churn.features import tenure

def test_tenure_in_months():
    df = pd.DataFrame({
        "start": ["2026-01-15"],
        "end": ["2026-04-15"]})
    out = tenure(df)
    assert out.iloc[0] == 3`,
    tip: 'Tiny hand-made DataFrames make feature logic testable in milliseconds. Run pytest before every push, and in CI.' },
  { tool: 'Tooling', lang: 'shell', name: 'Environments with uv', family: 'Reproducibility',
    code: `uv init churn-model
uv add pandas scikit-learn
uv add --dev pytest ruff
uv run pytest
# uv.lock pins exact versions`,
    tip: 'One fast tool for virtual environments, dependencies and running commands. Commit the lock file so everyone gets exactly the same versions.' },
  { tool: 'Tooling', lang: 'shell', name: 'Lint and format with Ruff', family: 'Code quality',
    code: `ruff check --fix .
ruff format .`,
    tip: 'Automatic formatting ends style debates in code review, and the linter catches unused imports, undefined names and common bugs in milliseconds.' },
  { tool: 'Tooling', lang: 'yaml', name: 'Pre-commit hooks', family: 'Code quality',
    code: `# .pre-commit-config.yaml
repos:
  - repo: https://github.com/
      astral-sh/ruff-pre-commit
    rev: v0.6.9
    hooks:
      - id: ruff
      - id: ruff-format`,
    tip: 'Checks that run automatically on git commit, so badly formatted code or notebook outputs never even reach the repository.' },
  { tool: 'Tooling', lang: 'yaml', name: 'CI on every pull request', family: 'Automation',
    code: `# .github/workflows/ci.yml
on: pull_request
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v3
      - run: uv run ruff check .
      - run: uv run pytest`,
    tip: 'Every pull request gets linted and tested on a clean machine. “Works on my laptop” stops being an argument.' },
  { tool: 'Python', lang: 'python', name: 'Logging, not print', family: 'Code quality',
    code: `import logging
log = logging.getLogger(__name__)

log.info("Loaded %d rows", len(df))
if df.empty:
    log.warning("No data: %s", day)`,
    tip: 'Logs have levels, timestamps and a source, and can be turned up or down without editing code. Essential once code runs unattended.' },
  { tool: 'Python', lang: 'python', name: 'Secrets stay out of code', family: 'Security',
    code: `import os

user = os.environ["SNOWFLAKE_USER"]
key = os.environ["SNOWFLAKE_KEY"]
# locally: a .env file that is
# listed in .gitignore`,
    tip: 'Read credentials from environment variables or a secrets manager, never from source code. Code gets shared; secrets mustn’t.' },
  { tool: 'Python', lang: 'python', name: 'Type hints', family: 'Code quality',
    code: `def churn_rate(
    df: pd.DataFrame,
    by: list[str],
    min_n: int = 30,
) -> pd.Series:
    ...`,
    tip: 'Types document what a function expects, let your editor autocomplete and catch mistakes, and can be checked automatically with mypy or pyright.' },
  { tool: 'Tooling', lang: 'shell', name: 'Containers for reproducibility', family: 'Reproducibility',
    code: `FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN pip install uv \\
 && uv sync --frozen
COPY src/ src/
CMD ["uv", "run", "python",
     "-m", "churn.train"]`,
    tip: 'A Docker image packages code, dependencies and system libraries, so a training job runs the same on a laptop, in CI and in production.' },
  { tool: 'Python', lang: 'python', name: 'Validate data at the boundary', family: 'Data quality',
    code: `import pandera.pandas as pa

C, Chk = pa.Column, pa.Check
schema = pa.DataFrameSchema({
  "id": C(int, unique=True),
  "age": C(int, Chk.ge(16)),
  "plan": C(str, Chk.isin(PLANS)),
})
schema.validate(df)`,
    tip: 'Fail fast when input data breaks your assumptions, instead of training or predicting on garbage. Validate where data enters your code.' },
  { tool: 'MLOps', lang: 'python', name: 'Track experiments', family: 'Experiment tracking',
    code: `import mlflow

with mlflow.start_run():
    mlflow.log_params(
        {"depth": 6, "lr": 0.1})
    model.fit(X_tr, y_tr)
    mlflow.log_metric("auc", auc)
    mlflow.sklearn.log_model(
        model, "model")`,
    tip: 'Log parameters, metrics and the model for every run. “Which settings gave that 0.87 last month?” becomes a lookup, not archaeology.' },
  { cat: 'eng', name: 'Notebooks explore, modules keep', family: 'Structure', tip: 'Explore freely in notebooks, but once code is reused or scheduled, move it into functions in a module with tests. Notebooks are hard to review, test and rerun in order.' },
  { cat: 'eng', name: 'Small pull requests', family: 'Collaboration', tip: 'A 50-line change gets a careful review; a 2,000-line change gets “looks good”. Split work into small, focused changes that each do one thing.' },
  { cat: 'eng', name: 'Review code like a colleague', family: 'Collaboration', tip: 'Ask questions rather than give orders, explain the why, and separate must-fix from nice-to-have. For analysis code, also check the logic and the numbers, not just the style.' },
  { cat: 'eng', name: 'Make it work, right, fast', family: 'Craft', tip: 'First get a correct result, then make the code clean and tested, and only then optimise, guided by measurement. Most “slow” code is slow in one place.' },
  { cat: 'eng', name: 'Write the README first', family: 'Craft', tip: 'Explain what the project does, how to install and run it, and where the data comes from. If it’s hard to explain, the design probably needs work.' },
  { cat: 'eng', tool: 'MLOps', name: 'Training–serving skew', family: 'Systems', tip: 'If features are computed one way in training (SQL, batch) and another way in production (an API, in real time), the model sees different data live. Share one feature definition for both.' },
  { cat: 'eng', tool: 'MLOps', name: 'Batch or real-time?', family: 'Deployment', tip: 'If predictions can be computed nightly and stored in a table, do that: it’s far simpler to build and monitor. Real-time serving is for when the answer depends on what just happened.' },
  { cat: 'eng', tool: 'MLOps', name: 'Use a model registry', family: 'Deployment', tip: 'Store every candidate model with its version, metrics, training data and code commit, and promote between stages (staging, production) explicitly. Rollback becomes one click.' },
  { cat: 'eng', tool: 'MLOps', name: 'Feature stores', family: 'Systems', tip: 'A shared catalogue of computed features with consistent definitions for training and serving, point-in-time correct joins, and reuse across models and teams.' },
  { cat: 'eng', tool: 'MLOps', name: 'Version data, not just code', family: 'Reproducibility', tip: 'A model is code plus data plus parameters. Record which snapshot of the data trained it, using table versions, time travel, DVC or immutable files.' },
  { cat: 'eng', tool: 'MLOps', name: 'Monitor inputs, not just accuracy', family: 'Monitoring', tip: 'Labels often arrive weeks later, so accuracy alerts come late. Watch input distributions, null rates and prediction distributions to catch problems the same day.' },
  { cat: 'eng', tool: 'MLOps', name: 'Write a model card', family: 'Governance', tip: 'Document what the model is for and not for, its training data, metrics overall and by segment, known limitations and an owner. Short, honest and kept next to the model.' },
  { cat: 'eng', tool: 'MLOps', name: 'Always have a rollback', family: 'Deployment', tip: 'Before deploying a new model, know how to switch back in minutes, and test that you can. Keep the previous version deployable until the new one has proven itself.' },
].map(t => ({ cat: 'eng', ...t }));

// ---- EDA (in Charts & EDA), time series and graph analytics ----
const EXTRA = [
  { tool: 'EDA', lang: 'python', name: 'First look at a DataFrame', family: 'First steps',
    code: `df.shape
df.sample(10)
df.info()
df.describe(include="all").T
df.isna().mean().sort_values()`,
    tip: 'Five lines to see size, raw rows, types, summary statistics and missing values. Always look at actual rows, not just the summaries.' },
  { tool: 'EDA', lang: 'python', name: 'Find duplicates', family: 'Data quality',
    code: `key = ["customer_id", "order_date"]
dups = df[df.duplicated(
    subset=key, keep=False)]
len(dups), dups.head()`,
    tip: 'Check that the key you think is unique really is. keep=False shows every copy, so you can see whether duplicates are identical or conflicting.' },
  { tool: 'EDA', lang: 'python', name: 'Cross-tabulate', family: 'Relationships',
    code: `pd.crosstab(df.plan, df.churned,
            normalize="index",
            margins=True)`,
    tip: 'Shares of one categorical variable within another: here churn rate per plan, with totals. Quick and easier to read than a groupby chain.' },
  { tool: 'EDA', name: 'Know the grain', family: 'First steps', tip: 'Before anything else, answer: what does one row represent? One order, one order line, one customer per day? Most wrong numbers come from joining or counting at the wrong grain.' },
  { tool: 'EDA', name: 'Reconcile with a trusted number', family: 'First steps', tip: 'Compare your totals with a number you trust: finance’s revenue, last month’s report, the source system. If they don’t match, find out why before you analyse anything.' },
  { tool: 'EDA', name: 'Question every filter', family: 'Data quality', tip: 'Every WHERE clause and dropna() removes data. Count rows before and after each step, and ask whether the removed rows differ from the rest.' },
  { tool: 'EDA', name: 'Plot before you model', family: 'First steps', tip: 'Summary statistics can hide wildly different data (see Anscombe’s quartet). Look at distributions, relationships and time trends before choosing a model.' },
  { tool: 'EDA', name: 'Keep a log of surprises', family: 'Workflow', tip: 'Write down every oddity as you explore: weird values, unexpected counts, questions for data owners. It becomes your list of caveats and your best source of insight.' },

  { cat: 'ts', tool: 'Python', lang: 'python', name: 'Lag and rolling features', family: 'Features',
    code: `df = df.sort_values("date")
g = df.groupby("store")["sales"]
df["lag_7"] = g.shift(7)
df["mean_28"] = g.transform(
    lambda s: s.shift(1)
               .rolling(28).mean())`,
    tip: 'Past values make strong features for forecasting. Always shift before rolling so a feature never includes the value it’s predicting.' },
  { cat: 'ts', tool: 'Python', lang: 'python', name: 'Time-aware cross-validation', family: 'Evaluation',
    code: `from sklearn.model_selection \\
    import TimeSeriesSplit

cv = TimeSeriesSplit(n_splits=5,
                     gap=7)
scores = cross_val_score(
    model, X, y, cv=cv)`,
    tip: 'Each fold trains on the past and tests on the future. gap leaves a buffer so features built from recent days don’t leak into the test period.' },
  { cat: 'ts', tool: 'Python', lang: 'python', name: 'STL decomposition', family: 'Decomposition',
    code: `from statsmodels.tsa.seasonal \\
    import STL

res = STL(daily, period=7,
          robust=True).fit()
res.trend, res.seasonal, res.resid
res.plot()`,
    tip: 'Splits a series into trend, seasonality and remainder. robust=True stops outliers from distorting the trend and seasonal parts.' },
  { cat: 'ts', name: 'Split by time, never randomly', family: 'Evaluation', tip: 'Random train/test splits let the model peek at the future and report accuracy you will never see in production. Train on earlier data, test on later data.' },
  { cat: 'ts', name: 'Fill in missing timestamps', family: 'Data preparation', tip: 'A day with no sales often has no row at all. Reindex to a complete calendar first, otherwise lags, rolling windows and averages quietly use the wrong days.' },
  { cat: 'ts', name: 'Mind the calendar', family: 'Data preparation', tip: 'Holidays, Easter moving between March and April, month lengths, paydays and daylight saving time all shift patterns. Add them as features or compare like with like.' },
  { cat: 'ts', name: 'Forecast ranges, not points', family: 'Forecasting', tip: 'A single number pretends to certainty. Give a prediction interval (“between 900 and 1,200, most likely 1,050”) so planners can size buffers and stock.' },
  { cat: 'ts', name: 'Forecast at the level decisions are made', family: 'Forecasting', tip: 'Store-level forecasts are noisy; national ones hide local problems. Forecast where decisions are made, and reconcile levels so they add up (hierarchical forecasting).' },

  { cat: 'graph', tool: 'Cypher', lang: 'cypher', name: 'Query a graph database', family: 'Tools',
    code: `// Friends of friends, not friends
MATCH (a:Person {name: 'Ada'})
      -[:KNOWS]->()-[:KNOWS]->(f)
WHERE NOT (a)-[:KNOWS]->(f)
  AND f <> a
RETURN f.name, count(*) AS mutual
ORDER BY mutual DESC LIMIT 5`,
    tip: 'Cypher (Neo4j and others) describes patterns as ASCII-art arrows. Multi-hop questions that need many self-joins in SQL become a single readable pattern.' },
  { cat: 'graph', tool: 'NetworkX', lang: 'python', name: 'Graph analytics in Python', family: 'Tools',
    code: `import networkx as nx

G = nx.from_pandas_edgelist(
    edges, "src", "dst")
pr = nx.pagerank(G)
comms = nx.community \\
    .louvain_communities(G)
nx.shortest_path(G, "a", "z")`,
    tip: 'NetworkX turns an edge list into a graph with centrality, communities and paths in one line each. Fine up to about a million edges; beyond that use a graph database or igraph.' },
  { cat: 'graph', tool: 'SQL', lang: 'sql', name: 'Graphs in SQL: recursive CTEs', family: 'Tools',
    code: `WITH RECURSIVE chain AS (
  SELECT id, manager_id, 1 AS depth
  FROM employees WHERE id = 42
  UNION ALL
  SELECT e.id, e.manager_id, depth+1
  FROM employees e
  JOIN chain c
    ON e.id = c.manager_id
)
SELECT * FROM chain;`,
    tip: 'Hierarchies such as org charts, bills of materials and referral chains can be walked in plain SQL with a recursive CTE, no graph database needed.' },
  { cat: 'graph', name: 'Graph features for ML', family: 'Applications', tip: 'Degree, PageRank, community and “share of neighbours who churned” are powerful features for churn, fraud and recommendation models: who you’re connected to says a lot about you.' },
  { cat: 'graph', name: 'Fraud rings', family: 'Applications', tip: 'Fraudsters share devices, addresses, phone numbers and bank accounts. Linking accounts through shared attributes exposes rings that look innocent one account at a time.' },
  { cat: 'graph', name: 'Link prediction', family: 'Applications', tip: 'Predict which edges are missing or will form next, such as people you may know, products bought together or likely collaborations, from common neighbours and graph structure.' },
  { cat: 'graph', name: 'Graph embeddings and GNNs', family: 'Machine learning', tip: 'Node2vec and graph neural networks learn vectors for nodes from their neighbourhoods, so graph structure can feed any standard ML model.' },
].map(t => ({ cat: 'chart', ...t }));

// ---- Analytics, data engineering, practical ML, models, NLP, geo, BI ----
const MORE = [
  // analytics & metrics
  { cat: 'biz', name: 'Choose a North Star metric', family: 'Metric design', tip: 'One metric that best captures the value customers get, such as weekly active teams or orders delivered on time. It aligns teams; supporting metrics explain how to move it.' },
  { cat: 'biz', name: 'Leading and lagging indicators', family: 'Metric design', tip: 'Revenue and churn tell you what already happened. Find the behaviours that predict them weeks earlier, such as activation, usage depth or support tickets, and steer by those.' },
  { cat: 'biz', name: 'Goodhart’s law', family: 'Metric design', wiki: 'Goodhart%27s_law', tip: '“When a measure becomes a target, it ceases to be a good measure.” Reward call length and calls get rushed. Pair every target with a counter-metric that catches gaming.' },
  { cat: 'biz', name: 'Define churn precisely', family: 'Retention', tip: 'Cancelled, didn’t renew, or inactive for 30 days? Subscriptions and usage-based products need different definitions. Write it down, including the time window, and use it everywhere.' },
  { cat: 'biz', name: 'Ratios need their denominators', family: 'Metric design', tip: 'Conversion fell from 4% to 3%: because fewer bought, or because a campaign brought many more visitors? Always show the numerator and the denominator alongside the ratio.' },
  { cat: 'biz', name: 'Compare year over year', family: 'Explaining changes', tip: 'For seasonal businesses, December versus November tells you about Christmas, not performance. Compare with the same period last year, aligned on weekdays and holidays.' },
  { cat: 'biz', name: 'Unit economics', family: 'Unit economics', tip: 'What does one customer cost to win (CAC), and what margin do they bring over their lifetime (LTV)? LTV/CAC above about 3 with payback within a year is a common rule of thumb.' },
  { cat: 'biz', name: 'Stickiness: DAU/MAU', family: 'Engagement', tip: 'Daily active users divided by monthly active users: how many days a month the average user comes back. 0.5 means about every other day. Compare it with products used at a similar cadence.' },
  { cat: 'biz', name: 'Segment before you average', family: 'Explaining changes', tip: 'An overall average mixes groups that behave differently. Break new metrics down by key segments (new vs returning, channel, country) before concluding anything.' },
  { cat: 'biz', tool: 'SQL', lang: 'sql', name: 'Funnel conversion in SQL', family: 'Funnels',
    code: `SELECT
  COUNT(DISTINCT IFF(step = 'visit',
    user_id, NULL)) AS visits,
  COUNT(DISTINCT IFF(step = 'cart',
    user_id, NULL)) AS carts,
  COUNT(DISTINCT IFF(step = 'paid',
    user_id, NULL)) AS paid,
  paid / NULLIF(visits, 0) AS conv
FROM events;`,
    tip: 'Distinct users reaching each step, in one pass. Snowflake lets later columns reuse earlier aliases. Decide whether steps must happen in order and within a time window.' },
  { cat: 'biz', tool: 'Python', lang: 'python', name: 'Cohort table in pandas', family: 'Retention',
    code: `df["cohort"] = (df.groupby("user")
    ["month"].transform("min"))
df["age"] = (df.month - df.cohort
             ).apply(lambda d: d.n)
tab = (df.groupby(["cohort", "age"])
         .user.nunique().unstack())
retention = tab.div(tab[0], axis=0)`,
    tip: 'Users by first month and months since, then divided by month 0. Months are pandas Periods here, so subtracting gives an offset whose .n is the number of months.' },

  // data modelling, orchestration & Snowflake (code source)
  { cat: 'code', tool: 'Modelling', name: 'Facts and dimensions', family: 'Data modelling', tip: 'Facts are events you measure and sum: orders, payments, page views. Dimensions describe them: customer, product, date, store. Ask “what happened?” for facts and “who, what, when, where?” for dimensions.' },
  { cat: 'code', tool: 'Modelling', name: 'Declare the grain', family: 'Data modelling', tip: 'Write the grain of every fact table in one sentence (“one row per order line”) before adding columns. Mixing grains in one table is the most common cause of double counting.' },
  { cat: 'code', tool: 'Modelling', name: 'One big table or a star?', family: 'Data modelling', tip: 'Wide denormalised tables are easy for analysts and fast in columnar warehouses; star schemas keep definitions in one place. A common compromise: model as a star, publish wide marts on top.' },
  { cat: 'code', tool: 'Modelling', name: 'Make pipelines idempotent', family: 'Pipelines', tip: 'Running a job twice must give the same result as running it once: overwrite or merge a partition instead of appending. Then retries and backfills are safe.' },
  { cat: 'code', tool: 'Modelling', name: 'Plan for backfills', family: 'Pipelines', tip: 'Logic changes and bugs mean reprocessing history. Parameterise jobs by date, keep raw data, and make sure a run for last March only touches last March.' },
  { cat: 'code', tool: 'dbt', lang: 'yaml', name: 'Data contracts', family: 'Data modelling',
    code: `models:
  - name: dim_customers
    config:
      contract: {enforced: true}
    columns:
      - name: customer_id
        data_type: int
        constraints:
          - type: not_null`,
    tip: 'An enforced contract makes dbt fail the build if a model’s columns or types change, so downstream dashboards and models don’t break silently.' },
  { cat: 'code', tool: 'dbt', lang: 'dbt', name: 'Surrogate keys', family: 'Data modelling',
    code: `select
  {{ dbt_utils
     .generate_surrogate_key(
       ['order_id', 'line_no']) }}
    as order_line_key,
  *
from {{ ref('stg_order_lines') }}`,
    tip: 'A hashed key built from the natural key columns gives every row of a fact or dimension a single, stable ID to join and test on.' },
  { cat: 'code', tool: 'Orchestration', lang: 'python', name: 'An Airflow DAG', family: 'Airflow',
    code: `from airflow.sdk import dag, task

@dag(schedule="@daily")
def orders():
    @task
    def extract(): ...
    @task
    def load(rows): ...
    load(extract())
orders()`,
    tip: 'Tasks and their dependencies as plain Python (Airflow 3 syntax). The scheduler runs it daily, retries failures and keeps a history of every run.' },
  { cat: 'code', tool: 'Orchestration', lang: 'python', name: 'Dagster assets', family: 'Dagster',
    code: `from dagster import asset

@asset
def raw_orders():
    return load_from_api()

@asset
def daily_revenue(raw_orders):
    return summarise(raw_orders)`,
    tip: 'Instead of tasks, declare the data assets you want and what they depend on; Dagster works out the order and tracks when each was last updated.' },
  { cat: 'code', tool: 'Snowflake', lang: 'sql', name: 'Right-size a warehouse', family: 'Cost & performance',
    code: `CREATE WAREHOUSE analytics_wh
  WAREHOUSE_SIZE = 'XSMALL'
  AUTO_SUSPEND = 60
  AUTO_RESUME = TRUE
  INITIALLY_SUSPENDED = TRUE;`,
    tip: 'Start small and let it suspend after 60 idle seconds: you pay per second while it runs. Separate warehouses per workload make costs visible and stop jobs blocking each other.' },
  { cat: 'code', tool: 'Snowflake', lang: 'sql', name: 'Cap spend with a resource monitor', family: 'Cost & performance',
    code: `CREATE RESOURCE MONITOR team_rm
  WITH CREDIT_QUOTA = 200
  FREQUENCY = MONTHLY
  TRIGGERS
    ON 80 PERCENT DO NOTIFY
    ON 100 PERCENT DO SUSPEND;
ALTER WAREHOUSE analytics_wh
  SET RESOURCE_MONITOR = team_rm;`,
    tip: 'Get warned at 80% of the monthly credit budget and stop new queries at 100%. A cheap insurance policy against a runaway query or a forgotten warehouse.' },
  { cat: 'code', tool: 'Snowflake', lang: 'sql', name: 'Find expensive queries', family: 'Cost & performance',
    code: `SELECT query_text, warehouse_name,
  total_elapsed_time / 1000 AS secs,
  bytes_scanned / 1e9 AS gb
FROM snowflake.account_usage
  .query_history
WHERE start_time >
  DATEADD('day', -7, CURRENT_DATE)
ORDER BY secs DESC
LIMIT 20;`,
    tip: 'The slowest queries of the past week, with how much data they scanned. Usually a handful of queries drive most of the cost; fix those first.' },
  { cat: 'code', tool: 'Snowflake', lang: 'sql', name: 'Clustering keys', family: 'Cost & performance',
    code: `ALTER TABLE events
  CLUSTER BY (event_date);

SELECT SYSTEM$CLUSTERING_INFORMATION(
  'events', '(event_date)');`,
    tip: 'For very large tables that are always filtered on the same column, a clustering key keeps similar values together so queries skip most partitions. Not worth it for small tables.' },
  { cat: 'code', tool: 'Snowflake', lang: 'sql', name: 'Zero-copy clones', family: 'Workflow',
    code: `CREATE DATABASE analytics_dev
  CLONE analytics;

CREATE TABLE orders_backup
  CLONE orders
  AT(OFFSET => -3600);`,
    tip: 'A full copy of a table or database in seconds, without duplicating storage until you change something. Ideal for dev environments, tests and “before” snapshots.' },
  { cat: 'code', tool: 'Snowflake', lang: 'sql', name: 'Dynamic tables', family: 'Pipelines',
    code: `CREATE DYNAMIC TABLE daily_sales
  TARGET_LAG = '1 hour'
  WAREHOUSE = transform_wh
AS
SELECT order_date, SUM(amount) AS rev
FROM orders
GROUP BY order_date;`,
    tip: 'Declare the query and how fresh the result must be; Snowflake keeps it updated incrementally. A simple alternative to hand-built streams and tasks for many pipelines.' },
  { cat: 'code', tool: 'Snowflake', lang: 'python', name: 'Snowpark DataFrames', family: 'Python in Snowflake',
    code: `from snowflake.snowpark.functions \\
    import col, sum as sum_

df = (session.table("orders")
  .filter(col("status") == "paid")
  .group_by("country")
  .agg(sum_("amount").alias("rev")))
df.show()`,
    tip: 'Write pandas-like Python that runs as SQL inside Snowflake, so the data never leaves the warehouse. Good for large data and for sharing logic with Python users.' },
  { cat: 'code', tool: 'Snowflake', lang: 'sql', name: 'LLM functions with Cortex', family: 'AI in SQL',
    code: `SELECT review,
  SNOWFLAKE.CORTEX.SENTIMENT(review)
    AS sentiment,
  SNOWFLAKE.CORTEX.SUMMARIZE(review)
    AS summary
FROM product_reviews
LIMIT 100;`,
    tip: 'Run sentiment, summarisation, translation or prompts over a text column directly in SQL. Try it on a sample first: cost scales with the amount of text.' },
  { cat: 'code', tool: 'Snowflake', name: 'Scale up for speed, out for concurrency', family: 'Cost & performance', tip: 'A bigger warehouse makes one heavy query faster. Many people running queries at once need a multi-cluster warehouse instead, which adds clusters when queries start to queue.' },
  { cat: 'code', tool: 'Snowflake', name: 'Let the result cache work', family: 'Cost & performance', tip: 'An identical query on unchanged data returns from the result cache for 24 hours at no warehouse cost. Dashboards benefit most; avoid needless CURRENT_TIMESTAMP() in their queries.' },

  // practical ML
  { cat: 'ml', tool: 'Python', lang: 'python', name: 'Gradient boosting with early stopping', family: 'Practical ML',
    code: `import lightgbm as lgb

model = lgb.LGBMClassifier(
    n_estimators=5000,
    learning_rate=0.03)
model.fit(X_tr, y_tr,
    eval_set=[(X_va, y_va)],
    callbacks=[
        lgb.early_stopping(100)])`,
    tip: 'Gradient-boosted trees (LightGBM, XGBoost, CatBoost) are the default winner on tabular data. Set many trees and let early stopping on a validation set decide when to stop.' },
  { cat: 'ml', tool: 'Python', lang: 'python', name: 'Tune with Optuna', family: 'Tuning',
    code: `import optuna
def objective(t):
    d = t.suggest_int("depth", 3, 10)
    lr = t.suggest_float(
        "lr", 1e-3, 0.3, log=True)
    return cv_auc(d, lr)

s = optuna.create_study(
    direction="maximize")
s.optimize(objective, n_trials=50)`,
    tip: 'Optuna searches smartly, spending more trials where results look promising, and prunes bad trials early. Tune on cross-validation, never on the test set.' },
  { cat: 'ml', tool: 'Python', lang: 'python', name: 'Target encoding', family: 'Feature engineering',
    code: `from sklearn.preprocessing import \\
    TargetEncoder

enc = TargetEncoder(cv=5)
X_tr["zip_te"] = enc.fit_transform(
    X_tr[["zip"]], y_tr).ravel()`,
    tip: 'Replaces each category (like 4,000 postcodes) by a smoothed average of the target. The built-in cross-fitting stops the encoding from leaking each row’s own label.' },
  { cat: 'ml', tool: 'Python', lang: 'python', name: 'Handling class imbalance', family: 'Imbalanced data',
    code: `clf = LogisticRegression(
    class_weight="balanced")
clf.fit(X_tr, y_tr)

proba = clf.predict_proba(X_te)[:, 1]
pred = proba >= best_threshold`,
    tip: 'Weight the rare class instead of resampling, evaluate with precision/recall rather than accuracy, and choose the threshold from business costs, not 0.5.' },
  { cat: 'ml', name: 'Start with a dumb baseline', family: 'Practical ML', tip: 'Predict the most common class, last week’s value or a two-feature logistic regression first. If your complex model can’t clearly beat it, something is wrong with the model or the problem.' },
  { cat: 'ml', name: 'Feature engineering ideas', family: 'Feature engineering', tip: 'Ratios (spend per visit), recency (days since last order), counts and sums over windows (orders last 30 days), trends (this month vs last) and group comparisons (vs segment average).' },
  { cat: 'ml', name: 'Leakage checklist', family: 'Pitfalls', tip: 'Was every feature known at prediction time? Are there duplicates or the same customer in train and test? Was scaling or encoding fitted on all data? Is the split by time when it should be?' },
  { cat: 'ml', name: 'Implicit feedback', family: 'Recommenders', tip: 'Most recommendation data is clicks, views and purchases, not ratings. Absence isn’t dislike. Use methods built for implicit data and evaluate with ranking metrics such as recall@k.' },

  // statistical models, simulation & optimisation
  { cat: 'stats', tool: 'Python', lang: 'python', name: 'Poisson GLM in statsmodels', family: 'GLMs',
    code: `import statsmodels.api as sm
import statsmodels.formula.api as smf

m = smf.glm(
    "claims ~ age + C(region)",
    data=df,
    family=sm.families.Poisson(),
    offset=np.log(df.exposure)).fit()
np.exp(m.params)  # rate ratios`,
    tip: 'Counts per unit of exposure (claims per policy-year, visits per day): the offset handles exposure, and exponentiated coefficients are multiplicative rate ratios.' },
  { cat: 'stats', tool: 'Python', lang: 'python', name: 'Mixed model', family: 'Multilevel models',
    code: `m = smf.mixedlm(
    "sales ~ promo + week",
    data=df,
    groups=df["store"]).fit()
m.summary()`,
    tip: 'A random intercept per store accounts for repeated measurements of the same stores, giving honest standard errors and partially pooled store effects.' },
  { cat: 'stats', tool: 'Python', lang: 'python', name: 'Bayesian model in PyMC', family: 'Bayesian statistics',
    code: `import pymc as pm

with pm.Model():
    p = pm.Beta("p", 1, 1, shape=2)
    pm.Binomial("y", p=p,
        n=[n_a, n_b],
        observed=[k_a, k_b])
    lift = pm.Deterministic(
        "lift", p[1] / p[0] - 1)
    idata = pm.sample()`,
    tip: 'Write the model as you’d describe it, and the sampler returns full posterior distributions for every quantity, including derived ones such as relative lift.' },
  { cat: 'stats', name: 'Pick the right GLM family', family: 'GLMs', tip: 'Yes/no outcomes: logistic. Counts: Poisson, or negative binomial when variance exceeds the mean. Positive, right-skewed amounts such as claim sizes: Gamma with a log link.' },
  { cat: 'stats', name: 'Credible vs confidence intervals', family: 'Bayesian statistics', tip: 'A 95% Bayesian credible interval means a 95% probability the value is inside, given the model and prior. A confidence interval describes how often the method captures the truth.' },
  { cat: 'stats', tool: 'Python', lang: 'python', name: 'Monte Carlo in NumPy', family: 'Simulation',
    code: `rng = np.random.default_rng(1)
n = 100_000
demand = rng.normal(1000, 150, n)
price = rng.uniform(90, 110, n)
cost = rng.triangular(50, 60, 80, n)
profit = demand * (price - cost)
np.percentile(profit, [5, 50, 95])`,
    tip: 'Replace single-number guesses with distributions, simulate 100,000 scenarios in one vectorised step, and report the range of outcomes, not just the middle.' },
  { cat: 'stats', tool: 'Python', lang: 'python', name: 'Optimise with SciPy', family: 'Optimisation',
    code: `from scipy.optimize import linprog

# max 3a + 5b  →  min −3a − 5b
res = linprog(c=[-3, -5],
    A_ub=[[1, 2], [3, 1]],
    b_ub=[14, 18],
    bounds=[(0, 5), (0, None)])
res.x, -res.fun`,
    tip: 'Linear programmes for production planning, staffing or budget allocation solve in milliseconds. For larger models with integer decisions, use PuLP or OR-Tools.' },
  { cat: 'stats', name: 'The value of information', family: 'Decisions', tip: 'Before running more analysis, ask: could the result change the decision, and what is that worth? If every plausible outcome leads to the same choice, decide now.' },

  // NLP (in AI)
  { cat: 'ai', tool: 'NLP', lang: 'python', name: 'TF-IDF classifier', family: 'Text classification',
    code: `clf = make_pipeline(
    TfidfVectorizer(
        ngram_range=(1, 2),
        min_df=3),
    LogisticRegression(
        max_iter=1000))
clf.fit(train.text, train.label)
clf.score(test.text, test.label)`,
    tip: 'Fast, cheap and surprisingly strong. Train it first: if an LLM or fine-tuned model can’t beat this baseline by a clear margin, it may not be worth the cost.' },
  { cat: 'ai', tool: 'NLP', lang: 'python', name: 'Embeddings + simple classifier', family: 'Text classification',
    code: `from sentence_transformers import \\
    SentenceTransformer

enc = SentenceTransformer(
    "all-MiniLM-L6-v2")
X = enc.encode(texts)
clf = LogisticRegression().fit(X, y)`,
    tip: 'Turn each text into an embedding with a pretrained model, then train any classifier on top. Needs far less labelled data than training from scratch, and it handles synonyms.' },
  { cat: 'ai', tool: 'NLP', lang: 'python', name: 'Named entities with spaCy', family: 'Information extraction',
    code: `import spacy

nlp = spacy.load("en_core_web_sm")
doc = nlp("Acme AS opened in Oslo "
          "on 3 March 2026.")
[(e.text, e.label_)
 for e in doc.ents]`,
    tip: 'Finds organisations, places, dates, amounts and people in free text, turning it into columns you can count and join. Check accuracy on your own documents.' },
  { cat: 'ai', tool: 'NLP', lang: 'python', name: 'Regex for messy text', family: 'Text cleaning',
    code: `import re

phone = re.compile(
    r"(\\+47)?\\s?\\d{8}")
df["has_phone"] = (df.text
    .str.contains(phone))
df["amount"] = (df.text.str.extract(
    r"(\\d+[.,]?\\d*)\\s?kr")[0])`,
    tip: 'Regular expressions extract structured bits such as phone numbers, amounts and IDs from free text, or mask them. Test patterns on real examples; regex101.com helps.' },
  { cat: 'ai', tool: 'NLP', name: 'Classic NLP or an LLM?', family: 'Text classification', tip: 'For a fixed, high-volume task with labels, a small classifier is cheaper, faster and more predictable. For varied tasks, few labels or nuanced judgement, an LLM wins. Compare both on a labelled sample.' },
  { cat: 'ai', tool: 'NLP', name: 'Norwegian text', family: 'Language', tip: 'Models trained mostly on English do worse on Norwegian, especially nynorsk and dialects. Look at Norwegian models such as NB-BERT (National Library) and NorBERT (University of Oslo), and evaluate on your own data.' },
  { cat: 'ai', tool: 'NLP', name: 'Label a sample first', family: 'Text classification', tip: 'Before building anything, label 200 to 500 real examples yourself. You learn what the categories really are, find ambiguous cases, and get a test set to judge every approach.' },

  // geo (in Charts, EDA & geo)
  { tool: 'Geo', lang: 'python', name: 'Distance on a sphere', family: 'Spatial analysis',
    code: `import numpy as np

def haversine_km(a1, o1, a2, o2):
    a1, o1, a2, o2 = map(
        np.radians, [a1, o1, a2, o2])
    h = (np.sin((a2 - a1) / 2)**2
         + np.cos(a1) * np.cos(a2)
         * np.sin((o2 - o1) / 2)**2)
    return 12742 * np.arcsin(
        np.sqrt(h))`,
    tip: 'Straight-line (great-circle) distance between coordinates, vectorised over whole columns. Real travel distance is longer, especially around Norwegian fjords.' },
  { tool: 'Geo', lang: 'python', name: 'Spatial join with GeoPandas', family: 'Spatial analysis',
    code: `import geopandas as gpd

pts = gpd.GeoDataFrame(df,
    geometry=gpd.points_from_xy(
        df.lon, df.lat), crs=4326)
areas = gpd.read_file(
    "kommuner.gpkg").to_crs(4326)
out = gpd.sjoin(pts, areas,
                predicate="within")`,
    tip: 'Assign each point to the polygon it lies in, such as customers to municipalities, then aggregate. Make sure both layers use the same coordinate reference system.' },
  { tool: 'Geo', lang: 'sql', name: 'Geo in Snowflake', family: 'Spatial analysis',
    code: `SELECT s.store_id, c.customer_id,
  ST_DISTANCE(
    ST_MAKEPOINT(s.lon, s.lat),
    ST_MAKEPOINT(c.lon, c.lat)
  ) / 1000 AS km,
  H3_LATLNG_TO_CELL(c.lat, c.lon, 8)
    AS h3_cell
FROM stores s, customers c;`,
    tip: 'Distances in metres and H3 cell IDs directly in SQL. Note that ST_MAKEPOINT takes longitude first, then latitude.' },
  { tool: 'Geo', name: 'Latitude or longitude first?', family: 'Pitfalls', tip: 'Some tools want (lat, lon), others (lon, lat), as in GeoJSON. Swapped coordinates put Oslo in the Indian Ocean. If your points land in the sea, check the order first.' },
  { tool: 'Geo', name: 'Mercator makes Norway look huge', family: 'Maps', wiki: 'Mercator_projection', tip: 'Web maps stretch areas away from the equator, so northern Norway looks enormous. For comparing areas or densities, use an equal-area projection, or hex and tile maps.' },
  { tool: 'Geo', name: 'Postcodes are not areas you can compare', family: 'Pitfalls', tip: 'Postcodes and municipalities vary hugely in size and population, and change over time. Normalise per person or per customer, and prefer stable grids such as H3 for analysis.' },

  // BI & dashboards (in Communication & BI)
  { cat: 'comm', tool: 'BI', name: 'Start from questions, not data', family: 'Dashboards', tip: 'List the three to five questions the audience asks every week, and design the dashboard to answer exactly those. Everything else goes in a separate exploration view, or nowhere.' },
  { cat: 'comm', tool: 'BI', name: 'One dashboard, one audience', family: 'Dashboards', tip: 'Executives, managers and analysts need different detail. A dashboard for everyone ends up useful to no one. Build focused views and link them.' },
  { cat: 'comm', tool: 'BI', name: 'Define metrics once', family: 'Semantic layer', tip: 'If “revenue” is calculated in five dashboards, it will soon have five values. Define metrics once in a semantic layer or dbt, and let every tool read from there.' },
  { cat: 'comm', tool: 'BI', name: 'When a dashboard isn’t the answer', family: 'Dashboards', tip: 'A one-off question deserves a short written analysis with a recommendation, not a dashboard nobody opens after week two. Dashboards are for recurring monitoring.' },
  { cat: 'comm', tool: 'BI', name: 'Give dashboards an owner', family: 'Governance', tip: 'Every dashboard needs an owner and a review date. Track usage and retire what nobody opens; stale dashboards with wrong numbers destroy trust in all the others.' },
  { cat: 'comm', tool: 'BI', name: 'Show freshness and definitions', family: 'Trust', tip: 'Display when the data was last updated and link to metric definitions. Most “the numbers are wrong” complaints are really “the data is from yesterday” or “we define it differently”.' },
  { cat: 'comm', tool: 'BI', name: 'Fast dashboards get used', family: 'Performance', tip: 'If a dashboard takes 30 seconds to load, people stop opening it. Pre-aggregate in the warehouse, limit default date ranges, and keep filters few and meaningful.' },
].map(t => ({ cat: 'chart', ...t }));

addTypes([...CODE, ...TOOLS].map(t => ({ cat: 'code', ...t })));
addTypes([...COMM, ...ENG, ...EXTRA, ...MORE]);
