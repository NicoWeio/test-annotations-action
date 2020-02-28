const core = require('@actions/core');
const github = require('@actions/github');
const fs = require('fs').promises;


async function run() {
  try {
    const ghToken = core.getInput("githubToken", { required: true });
    const octokit = new github.GitHub(ghToken);

    const reportPath = core.getInput('reportPath', { required: true });
    const checkRunNameEnvVar = core.getInput('checkRunNameEnvVar', { required: true });
    const checkRunNameVarPart = process.env[checkRunNameEnvVar];
    const context = github.context;
    const ref = getSha(context);
    const check_run = github.context.workflow;

    const reportContent = await fs.readFile(reportPath, 'utf8');
    const reports = JSON.parse(reportContent);

    const { data: { check_runs } } = await octokit.checks.listForRef({
        ...context.repo,
        ref,
        check_run,
        status: "in_progress"
    });

    const check_run_id = check_runs.filter(cr => cr.name.indexOf(checkRunNameVarPart) >= 0)[0].id;

    //The Github Checks API requires that Annotations are not submitted in batches of more than 50
    const batchedReports = batchIt(50, reports);
    core.info(`Adding ${reports.length} error(s) as annotations to check run with id ${check_run_id}`);

    for (const reports of batchedReports) {

      const annotations = reports.map(r => ({
        path: r.file,
        start_line: r.line,
        end_line: r.line,
        annotation_level: "failure",
        message: r.message,
        title: r.title
      }));


      await octokit.checks.update({
        ...context.repo,
        check_run_id,
        output: { title: `${check_run} Check Run`, summary: `${annotations.length} errors(s) found`, annotations }
      });

      core.info(`Finished adding ${annotations.length} annotations.`);
    }

    core.info(`Finished adding all annotations.`);
  }
  catch (error) {
    core.setFailed(error.message);
  }
}

const batchIt = (size, inputs) => inputs.reduce((batches, input) => {
  const current = batches[batches.length - 1];

  current.push(input);

  if (current.length == size) {
    batches.push([]);
  }

  return batches;
}, [[]]);

const getSha = (context) => {
  if (context.eventName === "pull_request") {
    return context.payload.after;
  } else {
    return context.sha;
  }
};

run();
