import fs from "node:fs";
import path from "node:path";

const manifestPath = path.resolve(
  "output/pdf/applications_2026-08-24_linkedin_wave2/application_batch_manifest.json",
);

const updates = {
  Branch: {
    official_application_url: "https://job-boards.greenhouse.io/embed/job_app?for=branchmetrics&token=8140379",
    status: "CAPTCHA handoff required",
    blocker: "Tailored resume and cover letter uploaded and verified fields completed. Greenhouse reCAPTCHA must be completed before final submission.",
  },
  Mistplay: {
    official_application_url: "https://jobs.lever.co/mistplay/50f40ccd-a45a-4290-919f-1295a08207da/apply",
    status: "confirmed submitted",
    submission_date_time: "2026-08-24 (exact time was not captured)",
    confirmation_evidence: "Visible Lever confirmation: Application submitted!",
    blocker: "",
  },
  "SS&C Technologies": {
    official_application_url: "https://www.linkedin.com/jobs/view/4409491641/",
    status: "blocked - Easy Apply email mismatch",
    blocker: "LinkedIn Easy Apply offers only OliverSlapinski@hotmail.com; the authorized application email is olliefromcanada@gmail.com.",
  },
  Notified: {
    official_application_url: "https://www.linkedin.com/jobs/view/4455759487/",
    status: "blocked - Easy Apply email mismatch",
    blocker: "LinkedIn Easy Apply offers only OliverSlapinski@hotmail.com; the authorized application email is olliefromcanada@gmail.com.",
  },
  myAbode: {
    official_application_url: "https://myabode.bamboohr.com/careers/263?source=LinkedIn",
    status: "prepared - user fields and CAPTCHA handoff required",
    blocker: "Resume uploaded and verified fields completed. Required street address, postal code, available date, Toronto office 3-days/week answer, and reCAPTCHA remain.",
  },
  Granum: {
    official_application_url: "https://job-boards.greenhouse.io/granum/jobs/8716272002?gh_src=z4a6byxf2us",
    status: "prepared - travel answer and CAPTCHA handoff required",
    blocker: "Tailored resume and cover letter uploaded and verified fields completed. Required US/Canada travel authorization answer and reCAPTCHA remain.",
  },
  "Leap Tools": {
    official_application_url: "https://jobs.gem.com/leap-tools/am9icG9zdDp9E98SOnW4N-NjwoOpP2yR",
    status: "prepared - file upload handoff required",
    blocker: "Verified text fields and role-specific ARR explanation completed. Gem's hidden file picker could not accept the tailored resume through browser control.",
  },
  Fittes: {
    official_application_url: "https://fittes.bamboohr.com/careers/93?source=LinkedIn",
    status: "prepared - user fields and CAPTCHA handoff required",
    blocker: "Resume uploaded and verified fields completed. Required street address, postal code, available date, Toronto office 3-days/week answer, and reCAPTCHA remain.",
  },
  "Peoples Group": {
    official_application_url: "https://recruiting.ultipro.ca/PEO5000PTC/JobBoard/6694b516-8e57-41f9-b4c2-78527f59c1f4/OpportunityDetail?opportunityId=57b244e1-a688-4b14-94f2-045191d43e71&source=LinkedIn",
    status: "login/account handoff required",
    blocker: "UKG redirects to a required account sign-in or sign-up before the application can continue.",
  },
  DCM: {
    official_application_url: "https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=2e04f94e-913a-4d07-aa95-facc4ff2e36c&ccId=19000101_000001&jobId=549035&source=LR&lang=en_CA",
    status: "login/account handoff required",
    blocker: "ADP requires account sign-in or account creation before the application can continue.",
  },
  "Foresters Financial": {
    official_application_url: "https://foresters.wd3.myworkdayjobs.com/en-US/ForestersFinancialCareers/job/Toronto%2C-Ontario/Client-Support-Specialist_R-2309/apply/applyManually?source=LinkedIn",
    status: "login/account handoff required",
    blocker: "Workday requires creating an account with a password before the application can continue.",
  },
  "Woodbine Entertainment": {
    official_application_url: "https://woodbineentertainment.wd10.myworkdayjobs.com/en-US/EXT/job/Etobicoke%2C-Ontario/Desktop-Analyst_JR1287/apply/applyManually?source=LinkedIn",
    status: "login/account handoff required",
    blocker: "Workday requires creating an account with a password before the application can continue.",
  },
  "Jonas Software": {
    official_application_url: "https://talentmanagementsolution.wd3.myworkdayjobs.com/en-US/JonasSoftwareCanada/job/Canada---Markham---Ontario/Jr-Customer-Support---Forms-Specialist_R49957-2/apply/applyManually",
    status: "prepared - travel answer handoff required",
    blocker: "Resume uploaded and verified answers completed. The required travel-willingness percentage must be confirmed before advancing to disclosures and review.",
  },
  Droptop: {
    official_application_url: "https://www.linkedin.com/jobs/view/4454425769/",
    status: "blocked - Easy Apply email mismatch",
    blocker: "LinkedIn Easy Apply offers only OliverSlapinski@hotmail.com; the authorized application email is olliefromcanada@gmail.com.",
  },
  Ascend: {
    official_application_url: "https://job-boards.greenhouse.io/embed/job_app?for=ascendpartnerservices&token=4718211007",
    status: "CAPTCHA handoff required",
    blocker: "Tailored resume and cover letter uploaded and all verified fields completed. Greenhouse reCAPTCHA must be completed before final submission.",
  },
};

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

for (const application of manifest) {
  const update = updates[application.company];
  if (!update) {
    throw new Error(`No status update defined for ${application.company}`);
  }
  Object.assign(application, update);
}

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

const counts = manifest.reduce((acc, application) => {
  const key = application.status;
  acc[key] = (acc[key] ?? 0) + 1;
  return acc;
}, {});

console.log(JSON.stringify({ manifestPath, counts }, null, 2));
