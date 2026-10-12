// The fixture catalogue: one import per JSON file of this folder (`happyPath_theCatalogueListsEveryFixtureFile` in
// functions/test/support/api-fixtures.test.ts keeps it complete). Add a file, add its import and its RAW_FIXTURES entry here.
import billingBudgetsCreateOk from './billing-budgets/create.ok.json' with { type: 'json' };
import billingBudgetsListNone from './billing-budgets/list.none.json' with { type: 'json' };
import billingBudgetsListOne from './billing-budgets/list.one.json' with { type: 'json' };
import cloudBillingBillingAccountsNone from './cloud-billing/billing-accounts.none.json' with { type: 'json' };
import cloudBillingBillingAccountsOneOpen from './cloud-billing/billing-accounts.one-open.json' with { type: 'json' };
import cloudBillingBillingInfoDisabled from './cloud-billing/billing-info.disabled.json' with { type: 'json' };
import cloudBillingBillingInfoEnabled from './cloud-billing/billing-info.enabled.json' with { type: 'json' };
import cloudBillingBillingInfoForbidden from './cloud-billing/billing-info.forbidden.json' with { type: 'json' };
import cloudRunExecutionCancelOperation from './cloud-run/execution.cancel.operation.json' with { type: 'json' };
import cloudRunExecutionCancelled from './cloud-run/execution.cancelled.json' with { type: 'json' };
import cloudRunExecutionFailed from './cloud-run/execution.failed.json' with { type: 'json' };
import cloudRunExecutionRunning from './cloud-run/execution.running.json' with { type: 'json' };
import cloudRunExecutionSucceeded from './cloud-run/execution.succeeded.json' with { type: 'json' };
import cloudRunJobNotFound from './cloud-run/job.not-found.json' with { type: 'json' };
import cloudRunJobsRunOperation from './cloud-run/jobs.run.operation.json' with { type: 'json' };
import cloudStorageBucketIamOk from './cloud-storage/bucket-iam.ok.json' with { type: 'json' };
import cloudStorageBucketIamPublicAccessPrevented from './cloud-storage/bucket-iam.public-access-prevented.json' with { type: 'json' };
import cloudStorageBucketCreated from './cloud-storage/bucket.created.json' with { type: 'json' };
import cloudStorageBucketExists from './cloud-storage/bucket.exists.json' with { type: 'json' };
import cloudStorageBucketGet from './cloud-storage/bucket.get.json' with { type: 'json' };
import cloudStorageBucketNotFound from './cloud-storage/bucket.not-found.json' with { type: 'json' };
import cloudTasksQueueCreated from './cloud-tasks/queue.created.json' with { type: 'json' };
import cloudTasksQueueGet from './cloud-tasks/queue.get.json' with { type: 'json' };
import cloudTasksQueueNotFound from './cloud-tasks/queue.not-found.json' with { type: 'json' };
import cloudTasksTaskCreated from './cloud-tasks/task.created.json' with { type: 'json' };
import cloudTasksTaskExists from './cloud-tasks/task.exists.json' with { type: 'json' };
import errorReportingGroupStatsEmpty from './error-reporting/group-stats.empty.json' with { type: 'json' };
import errorReportingGroupStatsTwoGroups from './error-reporting/group-stats.two-groups.json' with { type: 'json' };
import firebaseManagementAddGoogleAnalyticsOperation from './firebase-management/add-google-analytics.operation.json' with { type: 'json' };
import firebaseManagementAnalyticsDetailsLinked from './firebase-management/analytics-details.linked.json' with { type: 'json' };
import firebaseManagementAnalyticsDetailsNotLinked from './firebase-management/analytics-details.not-linked.json' with { type: 'json' };
import firebaseManagementOperationDone from './firebase-management/operation.done.json' with { type: 'json' };
import firebaseManagementWebAppConfigAnalytics from './firebase-management/web-app-config.analytics.json' with { type: 'json' };
import firebaseManagementWebAppConfigNoAnalytics from './firebase-management/web-app-config.no-analytics.json' with { type: 'json' };
import firebaseManagementWebAppsNone from './firebase-management/web-apps.none.json' with { type: 'json' };
import firebaseManagementWebAppsOneActive from './firebase-management/web-apps.one-active.json' with { type: 'json' };
import googleOauthTokeninfoExpired from './google-oauth/tokeninfo.expired.json' with { type: 'json' };
import googleOauthTokeninfoMissingScope from './google-oauth/tokeninfo.missing-scope.json' with { type: 'json' };
import googleOauthTokeninfoOtherAccount from './google-oauth/tokeninfo.other-account.json' with { type: 'json' };
import googleOauthTokeninfoOtherClient from './google-oauth/tokeninfo.other-client.json' with { type: 'json' };
import googleOauthTokeninfoOwner from './google-oauth/tokeninfo.owner.json' with { type: 'json' };
import googleErrorAborted from './google/error.aborted.json' with { type: 'json' };
import googleErrorAlreadyExists from './google/error.already-exists.json' with { type: 'json' };
import googleErrorInvalidArgument from './google/error.invalid-argument.json' with { type: 'json' };
import googleErrorNotFound from './google/error.not-found.json' with { type: 'json' };
import googleErrorPermissionDenied from './google/error.permission-denied.json' with { type: 'json' };
import googleErrorRateLimited from './google/error.rate-limited.json' with { type: 'json' };
import googleErrorServiceDisabled from './google/error.service-disabled.json' with { type: 'json' };
import googleErrorUnauthenticated from './google/error.unauthenticated.json' with { type: 'json' };
import googleErrorUnavailable from './google/error.unavailable.json' with { type: 'json' };
import iamAccountsCreateExists from './iam/accounts.create.exists.json' with { type: 'json' };
import iamAccountsCreateOk from './iam/accounts.create.ok.json' with { type: 'json' };
import iamAccountsGetNotFound from './iam/accounts.get.not-found.json' with { type: 'json' };
import iamAccountsGetOk from './iam/accounts.get.ok.json' with { type: 'json' };
import iamAccountsListOk from './iam/accounts.list.ok.json' with { type: 'json' };
import iamAccountsPolicyOk from './iam/accounts.policy.ok.json' with { type: 'json' };
import iamOperationDone from './iam/operation.done.json' with { type: 'json' };
import iamPoolsCreateOperation from './iam/pools.create.operation.json' with { type: 'json' };
import iamPoolsGetOk from './iam/pools.get.ok.json' with { type: 'json' };
import iamProvidersCreateOperation from './iam/providers.create.operation.json' with { type: 'json' };
import iamProvidersGetOk from './iam/providers.get.ok.json' with { type: 'json' };
import mapboxErrorForbidden from './mapbox/error.forbidden.json' with { type: 'json' };
import mapboxErrorNotFound from './mapbox/error.not-found.json' with { type: 'json' };
import mapboxErrorRateLimited from './mapbox/error.rate-limited.json' with { type: 'json' };
import mapboxErrorUnauthorized from './mapbox/error.unauthorized.json' with { type: 'json' };
import mapboxErrorUnavailable from './mapbox/error.unavailable.json' with { type: 'json' };
import mapboxStylesCreateOk from './mapbox/styles.create.ok.json' with { type: 'json' };
import mapboxStylesListNone from './mapbox/styles.list.none.json' with { type: 'json' };
import mapboxStylesListOne from './mapbox/styles.list.one.json' with { type: 'json' };
import mapboxTilesetsCreateExists from './mapbox/tilesets.create.exists.json' with { type: 'json' };
import mapboxTilesetsCreateOk from './mapbox/tilesets.create.ok.json' with { type: 'json' };
import mapboxTilesetsDeleteOk from './mapbox/tilesets.delete.ok.json' with { type: 'json' };
import mapboxTilesetsJobFailed from './mapbox/tilesets.job.failed.json' with { type: 'json' };
import mapboxTilesetsJobProcessing from './mapbox/tilesets.job.processing.json' with { type: 'json' };
import mapboxTilesetsJobQueued from './mapbox/tilesets.job.queued.json' with { type: 'json' };
import mapboxTilesetsJobSuccess from './mapbox/tilesets.job.success.json' with { type: 'json' };
import mapboxTilesetsListNone from './mapbox/tilesets.list.none.json' with { type: 'json' };
import mapboxTilesetsListOne from './mapbox/tilesets.list.one.json' with { type: 'json' };
import mapboxTilesetsPublishOk from './mapbox/tilesets.publish.ok.json' with { type: 'json' };
import mapboxTilesetsSourceCreated from './mapbox/tilesets.source.created.json' with { type: 'json' };
import mapboxTokensCreateBilling from './mapbox/tokens.create.billing.json' with { type: 'json' };
import mapboxTokensCreateDemoAccount from './mapbox/tokens.create.demo-account.json' with { type: 'json' };
import mapboxTokensCreatePublic from './mapbox/tokens.create.public.json' with { type: 'json' };
import mapboxTokensCreateSecret from './mapbox/tokens.create.secret.json' with { type: 'json' };
import mapboxTokensDeleteOk from './mapbox/tokens.delete.ok.json' with { type: 'json' };
import mapboxTokensListAllScopes from './mapbox/tokens.list.all-scopes.json' with { type: 'json' };
import mapboxTokensListMissingScopes from './mapbox/tokens.list.missing-scopes.json' with { type: 'json' };
import mapboxTokensRetrieveInvalid from './mapbox/tokens.retrieve.invalid.json' with { type: 'json' };
import mapboxTokensRetrievePublic from './mapbox/tokens.retrieve.public.json' with { type: 'json' };
import mapboxTokensRetrieveSecret from './mapbox/tokens.retrieve.secret.json' with { type: 'json' };
import mapboxTokensUpdateOk from './mapbox/tokens.update.ok.json' with { type: 'json' };
import nominatimErrorRateLimited from './nominatim/error.rate-limited.json' with { type: 'json' };
import nominatimErrorUnavailable from './nominatim/error.unavailable.json' with { type: 'json' };
import nominatimReverseOk from './nominatim/reverse.ok.json' with { type: 'json' };
import nominatimReverseUnable from './nominatim/reverse.unable.json' with { type: 'json' };
import resourceManagerGetIamPolicyOk from './resource-manager/get-iam-policy.ok.json' with { type: 'json' };
import resourceManagerProjectGet from './resource-manager/project.get.json' with { type: 'json' };
import resourceManagerSetIamPolicyOk from './resource-manager/set-iam-policy.ok.json' with { type: 'json' };
import resourceManagerSetIamPolicyOrgPolicy from './resource-manager/set-iam-policy.org-policy.json' with { type: 'json' };
import resourceManagerTestIamPermissionsEmpty from './resource-manager/test-iam-permissions.empty.json' with { type: 'json' };
import resourceManagerTestIamPermissionsForbidden from './resource-manager/test-iam-permissions.forbidden.json' with { type: 'json' };
import resourceManagerTestIamPermissionsGranted from './resource-manager/test-iam-permissions.granted.json' with { type: 'json' };
import secretManagerAccessNotFound from './secret-manager/access.not-found.json' with { type: 'json' };
import secretManagerAccessOk from './secret-manager/access.ok.json' with { type: 'json' };
import secretManagerAddVersionOk from './secret-manager/add-version.ok.json' with { type: 'json' };
import secretManagerDestroyOk from './secret-manager/destroy.ok.json' with { type: 'json' };
import secretManagerSecretCreated from './secret-manager/secret.created.json' with { type: 'json' };
import secretManagerSecretExists from './secret-manager/secret.exists.json' with { type: 'json' };
import secretManagerSecretGet from './secret-manager/secret.get.json' with { type: 'json' };
import secretManagerVersionsList from './secret-manager/versions.list.json' with { type: 'json' };
import serviceUsageBatchEnableOperation from './service-usage/batch-enable.operation.json' with { type: 'json' };
import serviceUsageEnableBillingRequired from './service-usage/enable.billing-required.json' with { type: 'json' };
import serviceUsageEnableOperation from './service-usage/enable.operation.json' with { type: 'json' };
import serviceUsageOperationDone from './service-usage/operation.done.json' with { type: 'json' };
import serviceUsageServiceDisabled from './service-usage/service.disabled.json' with { type: 'json' };
import serviceUsageServiceEnabled from './service-usage/service.enabled.json' with { type: 'json' };
import usgsDatasetSearchDeclass from './usgs/dataset-search.declass.json' with { type: 'json' };
import usgsDownloadOptionsAvailable from './usgs/download-options.available.json' with { type: 'json' };
import usgsDownloadOptionsOrderOnly from './usgs/download-options.order-only.json' with { type: 'json' };
import usgsDownloadRequestAvailable from './usgs/download-request.available.json' with { type: 'json' };
import usgsDownloadRetrieveAvailable from './usgs/download-retrieve.available.json' with { type: 'json' };
import usgsErrorApiKeyInvalid from './usgs/error.api-key-invalid.json' with { type: 'json' };
import usgsErrorRateLimit from './usgs/error.rate-limit.json' with { type: 'json' };
import usgsErrorUnavailable from './usgs/error.unavailable.json' with { type: 'json' };
import usgsLoginTokenAuthInvalid from './usgs/login-token.auth-invalid.json' with { type: 'json' };
import usgsLoginTokenHtml403 from './usgs/login-token.html-403.json' with { type: 'json' };
import usgsLoginTokenNoM2mAccess from './usgs/login-token.no-m2m-access.json' with { type: 'json' };
import usgsLoginTokenOk from './usgs/login-token.ok.json' with { type: 'json' };
import usgsLogoutOk from './usgs/logout.ok.json' with { type: 'json' };
import usgsMaintenanceHtml503 from './usgs/maintenance.html-503.json' with { type: 'json' };
import usgsPermissionsDownload from './usgs/permissions.download.json' with { type: 'json' };
import usgsPermissionsSearchOnly from './usgs/permissions.search-only.json' with { type: 'json' };
import usgsSceneSearchEmpty from './usgs/scene-search.empty.json' with { type: 'json' };
import usgsSceneSearchTwoScenes from './usgs/scene-search.two-scenes.json' with { type: 'json' };

/** Keeps the names as a literal union and the JSON types out of the declaration output. */
function catalogue<Name extends string>(entries: Readonly<Record<Name, unknown>>): Readonly<Record<Name, unknown>> {
    return entries;
}

/** Fixture name (`<service>/<operation>.<outcome>`, the file path without `.json`) → the raw JSON envelope. */
export const RAW_FIXTURES = catalogue({
    'billing-budgets/create.ok': billingBudgetsCreateOk,
    'billing-budgets/list.none': billingBudgetsListNone,
    'billing-budgets/list.one': billingBudgetsListOne,
    'cloud-billing/billing-accounts.none': cloudBillingBillingAccountsNone,
    'cloud-billing/billing-accounts.one-open': cloudBillingBillingAccountsOneOpen,
    'cloud-billing/billing-info.disabled': cloudBillingBillingInfoDisabled,
    'cloud-billing/billing-info.enabled': cloudBillingBillingInfoEnabled,
    'cloud-billing/billing-info.forbidden': cloudBillingBillingInfoForbidden,
    'cloud-run/execution.cancel.operation': cloudRunExecutionCancelOperation,
    'cloud-run/execution.cancelled': cloudRunExecutionCancelled,
    'cloud-run/execution.failed': cloudRunExecutionFailed,
    'cloud-run/execution.running': cloudRunExecutionRunning,
    'cloud-run/execution.succeeded': cloudRunExecutionSucceeded,
    'cloud-run/job.not-found': cloudRunJobNotFound,
    'cloud-run/jobs.run.operation': cloudRunJobsRunOperation,
    'cloud-storage/bucket-iam.ok': cloudStorageBucketIamOk,
    'cloud-storage/bucket-iam.public-access-prevented': cloudStorageBucketIamPublicAccessPrevented,
    'cloud-storage/bucket.created': cloudStorageBucketCreated,
    'cloud-storage/bucket.exists': cloudStorageBucketExists,
    'cloud-storage/bucket.get': cloudStorageBucketGet,
    'cloud-storage/bucket.not-found': cloudStorageBucketNotFound,
    'cloud-tasks/queue.created': cloudTasksQueueCreated,
    'cloud-tasks/queue.get': cloudTasksQueueGet,
    'cloud-tasks/queue.not-found': cloudTasksQueueNotFound,
    'cloud-tasks/task.created': cloudTasksTaskCreated,
    'cloud-tasks/task.exists': cloudTasksTaskExists,
    'error-reporting/group-stats.empty': errorReportingGroupStatsEmpty,
    'error-reporting/group-stats.two-groups': errorReportingGroupStatsTwoGroups,
    'firebase-management/add-google-analytics.operation': firebaseManagementAddGoogleAnalyticsOperation,
    'firebase-management/analytics-details.linked': firebaseManagementAnalyticsDetailsLinked,
    'firebase-management/analytics-details.not-linked': firebaseManagementAnalyticsDetailsNotLinked,
    'firebase-management/operation.done': firebaseManagementOperationDone,
    'firebase-management/web-app-config.analytics': firebaseManagementWebAppConfigAnalytics,
    'firebase-management/web-app-config.no-analytics': firebaseManagementWebAppConfigNoAnalytics,
    'firebase-management/web-apps.none': firebaseManagementWebAppsNone,
    'firebase-management/web-apps.one-active': firebaseManagementWebAppsOneActive,
    'google-oauth/tokeninfo.expired': googleOauthTokeninfoExpired,
    'google-oauth/tokeninfo.missing-scope': googleOauthTokeninfoMissingScope,
    'google-oauth/tokeninfo.other-account': googleOauthTokeninfoOtherAccount,
    'google-oauth/tokeninfo.other-client': googleOauthTokeninfoOtherClient,
    'google-oauth/tokeninfo.owner': googleOauthTokeninfoOwner,
    'google/error.aborted': googleErrorAborted,
    'google/error.already-exists': googleErrorAlreadyExists,
    'google/error.invalid-argument': googleErrorInvalidArgument,
    'google/error.not-found': googleErrorNotFound,
    'google/error.permission-denied': googleErrorPermissionDenied,
    'google/error.rate-limited': googleErrorRateLimited,
    'google/error.service-disabled': googleErrorServiceDisabled,
    'google/error.unauthenticated': googleErrorUnauthenticated,
    'google/error.unavailable': googleErrorUnavailable,
    'iam/accounts.create.exists': iamAccountsCreateExists,
    'iam/accounts.create.ok': iamAccountsCreateOk,
    'iam/accounts.get.not-found': iamAccountsGetNotFound,
    'iam/accounts.get.ok': iamAccountsGetOk,
    'iam/accounts.list.ok': iamAccountsListOk,
    'iam/accounts.policy.ok': iamAccountsPolicyOk,
    'iam/operation.done': iamOperationDone,
    'iam/pools.create.operation': iamPoolsCreateOperation,
    'iam/pools.get.ok': iamPoolsGetOk,
    'iam/providers.create.operation': iamProvidersCreateOperation,
    'iam/providers.get.ok': iamProvidersGetOk,
    'mapbox/error.forbidden': mapboxErrorForbidden,
    'mapbox/error.not-found': mapboxErrorNotFound,
    'mapbox/error.rate-limited': mapboxErrorRateLimited,
    'mapbox/error.unauthorized': mapboxErrorUnauthorized,
    'mapbox/error.unavailable': mapboxErrorUnavailable,
    'mapbox/styles.create.ok': mapboxStylesCreateOk,
    'mapbox/styles.list.none': mapboxStylesListNone,
    'mapbox/styles.list.one': mapboxStylesListOne,
    'mapbox/tilesets.create.exists': mapboxTilesetsCreateExists,
    'mapbox/tilesets.create.ok': mapboxTilesetsCreateOk,
    'mapbox/tilesets.delete.ok': mapboxTilesetsDeleteOk,
    'mapbox/tilesets.job.failed': mapboxTilesetsJobFailed,
    'mapbox/tilesets.job.processing': mapboxTilesetsJobProcessing,
    'mapbox/tilesets.job.queued': mapboxTilesetsJobQueued,
    'mapbox/tilesets.job.success': mapboxTilesetsJobSuccess,
    'mapbox/tilesets.list.none': mapboxTilesetsListNone,
    'mapbox/tilesets.list.one': mapboxTilesetsListOne,
    'mapbox/tilesets.publish.ok': mapboxTilesetsPublishOk,
    'mapbox/tilesets.source.created': mapboxTilesetsSourceCreated,
    'mapbox/tokens.create.billing': mapboxTokensCreateBilling,
    'mapbox/tokens.create.demo-account': mapboxTokensCreateDemoAccount,
    'mapbox/tokens.create.public': mapboxTokensCreatePublic,
    'mapbox/tokens.create.secret': mapboxTokensCreateSecret,
    'mapbox/tokens.delete.ok': mapboxTokensDeleteOk,
    'mapbox/tokens.list.all-scopes': mapboxTokensListAllScopes,
    'mapbox/tokens.list.missing-scopes': mapboxTokensListMissingScopes,
    'mapbox/tokens.retrieve.invalid': mapboxTokensRetrieveInvalid,
    'mapbox/tokens.retrieve.public': mapboxTokensRetrievePublic,
    'mapbox/tokens.retrieve.secret': mapboxTokensRetrieveSecret,
    'mapbox/tokens.update.ok': mapboxTokensUpdateOk,
    'nominatim/error.rate-limited': nominatimErrorRateLimited,
    'nominatim/error.unavailable': nominatimErrorUnavailable,
    'nominatim/reverse.ok': nominatimReverseOk,
    'nominatim/reverse.unable': nominatimReverseUnable,
    'resource-manager/get-iam-policy.ok': resourceManagerGetIamPolicyOk,
    'resource-manager/project.get': resourceManagerProjectGet,
    'resource-manager/set-iam-policy.ok': resourceManagerSetIamPolicyOk,
    'resource-manager/set-iam-policy.org-policy': resourceManagerSetIamPolicyOrgPolicy,
    'resource-manager/test-iam-permissions.empty': resourceManagerTestIamPermissionsEmpty,
    'resource-manager/test-iam-permissions.forbidden': resourceManagerTestIamPermissionsForbidden,
    'resource-manager/test-iam-permissions.granted': resourceManagerTestIamPermissionsGranted,
    'secret-manager/access.not-found': secretManagerAccessNotFound,
    'secret-manager/access.ok': secretManagerAccessOk,
    'secret-manager/add-version.ok': secretManagerAddVersionOk,
    'secret-manager/destroy.ok': secretManagerDestroyOk,
    'secret-manager/secret.created': secretManagerSecretCreated,
    'secret-manager/secret.exists': secretManagerSecretExists,
    'secret-manager/secret.get': secretManagerSecretGet,
    'secret-manager/versions.list': secretManagerVersionsList,
    'service-usage/batch-enable.operation': serviceUsageBatchEnableOperation,
    'service-usage/enable.billing-required': serviceUsageEnableBillingRequired,
    'service-usage/enable.operation': serviceUsageEnableOperation,
    'service-usage/operation.done': serviceUsageOperationDone,
    'service-usage/service.disabled': serviceUsageServiceDisabled,
    'service-usage/service.enabled': serviceUsageServiceEnabled,
    'usgs/dataset-search.declass': usgsDatasetSearchDeclass,
    'usgs/download-options.available': usgsDownloadOptionsAvailable,
    'usgs/download-options.order-only': usgsDownloadOptionsOrderOnly,
    'usgs/download-request.available': usgsDownloadRequestAvailable,
    'usgs/download-retrieve.available': usgsDownloadRetrieveAvailable,
    'usgs/error.api-key-invalid': usgsErrorApiKeyInvalid,
    'usgs/error.rate-limit': usgsErrorRateLimit,
    'usgs/error.unavailable': usgsErrorUnavailable,
    'usgs/login-token.auth-invalid': usgsLoginTokenAuthInvalid,
    'usgs/login-token.html-403': usgsLoginTokenHtml403,
    'usgs/login-token.no-m2m-access': usgsLoginTokenNoM2mAccess,
    'usgs/login-token.ok': usgsLoginTokenOk,
    'usgs/logout.ok': usgsLogoutOk,
    'usgs/maintenance.html-503': usgsMaintenanceHtml503,
    'usgs/permissions.download': usgsPermissionsDownload,
    'usgs/permissions.search-only': usgsPermissionsSearchOnly,
    'usgs/scene-search.empty': usgsSceneSearchEmpty,
    'usgs/scene-search.two-scenes': usgsSceneSearchTwoScenes,
});
