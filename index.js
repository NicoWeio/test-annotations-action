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
    core.debug(`Context: ${JSON.stringify(context, null, 2)}`);
    const ref = getSha(context);

    if (!ref) {
      core.error(`Context: ${JSON.stringify(context, null, 2)}`);
      return process.exit(1);
    }

    const workflow = github.context.workflow;

    const reportContent = await fs.readFile(reportPath, 'utf8');
    const reports = JSON.parse(reportContent);

    let check_run_id = null;
    let tries = 1;

    while(!check_run_id && tries <= 50) {
      const { data: { check_runs } } = await octokit.checks.listForRef({
          ...context.repo,
          ref,
          check_run: workflow,
          status: "in_progress"
      });

      const check_run = check_runs.filter(cr => cr.name.indexOf(checkRunNameVarPart) >= 0)[0];

      if(check_run) {
        check_run_id = check_run.id;
      }
    }

    if(!check_run_id) {
      throw new Error("Unable to find check run id after 50 tries");
    } else {
      console.log(`Found check_run_id after ${tries} tries: ${check_run_id}`);
    }



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
        output: { title: `${workflow} Check Run`, summary: `${annotations.length} errors(s) found`, annotations }
      });

      core.info(`Finished adding ${annotations.length} annotations.`);
    }

    core.info(`Finished adding all annotations.`);
  }
  catch (error) {
    core.error(`Context: ${JSON.stringify(github.context, null, 2)}`)
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
    return context.payload.pull_request.head.sha || context.payload.after;
  } else {
    return context.sha;
  }
};

run();
