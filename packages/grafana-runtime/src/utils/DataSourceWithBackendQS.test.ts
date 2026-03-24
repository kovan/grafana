import { of } from 'rxjs';
import { BackendSrv, BackendSrvRequest, FetchResponse } from 'src/services';
import { DataQuery } from '@grafana/schema';

import {
  DataQueryRequest,
  DataSourceInstanceSettings,
  DataSourceJsonData,
  DataSourceRef,
  AdHocVariableFilter,
  ScopedVars,
  getDefaultTimeRange,
} from '@grafana/data';

import { config } from '../config';

import { DataSourceWithBackend } from './DataSourceWithBackend';

interface MyQuery extends DataQuery {
  filters?: AdHocVariableFilter[];
  applyTemplateVariablesCalled?: boolean;
}

class MyDataSource extends DataSourceWithBackend<MyQuery, DataSourceJsonData> {
  constructor(instanceSettings: DataSourceInstanceSettings<DataSourceJsonData>) {
    super(instanceSettings);
  }

  applyTemplateVariables(query: MyQuery, scopedVars: ScopedVars, filters?: AdHocVariableFilter[] | undefined): MyQuery {
    return { ...query, applyTemplateVariablesCalled: true, filters };
  }

  async getValue(key: string) {
    return await this.userStorage.getItem(key);
  }

  async setValue(key: string, value: string) {
    await this.userStorage.setItem(key, value);
  }
}

const mockDatasourceRequest = jest.fn<Promise<FetchResponse>, BackendSrvRequest[]>();

const backendSrv = {
  fetch: (options: BackendSrvRequest) => {
    return of(mockDatasourceRequest(options));
  },
} as unknown as BackendSrv;

jest.mock('../services', () => ({
  ...jest.requireActual('../services'),
  getBackendSrv: () => backendSrv,
  getDataSourceSrv: () => {
    return {
      getInstanceSettings: (ref?: DataSourceRef) => ({
        type: ref?.type ?? '<mocktype>',
        uid: ref?.uid ?? '<mockuid>',
      }),
    };
  },
}));

const mockGetObjectValue = jest.fn().mockReturnValue({ types: ['prometheus'] });
jest.mock('../internal/openFeature', () => ({
  ...jest.requireActual('../internal/openFeature'),
  getFeatureFlagClient: () => ({
    getObjectValue: mockGetObjectValue,
  }),
}));

const mockIsQueryServiceCompatible = jest.fn().mockReturnValue(false);
jest.mock('./qscheck', () => ({
  ...jest.requireActual('./qscheck'),
  isQueryServiceCompatible: (a: any, b: any) => mockIsQueryServiceCompatible(a, b),
}));

describe('DataSourceWithBackend', () => {
  describe('queryServiceDecision', () => {
    let oldQsUI: boolean | undefined = undefined;
    beforeEach(() => {
      oldQsUI = config.featureToggles.queryServiceFromUI;
      config.featureToggles.queryServiceFromUI = true;
    });
    afterEach(() => {
      config.featureToggles.queryServiceFromUI = oldQsUI;
      mockGetObjectValue.mockReset().mockReturnValue({ types: ['prometheus'] });
      mockIsQueryServiceCompatible.mockReset().mockReturnValue(false);
    });

    const prometheus = {
      name: 'prm',
      id: 1,
      uid: 'p',
      type: 'prometheus',
      jsonData: {},
    } as DataSourceInstanceSettings;

    const loki = {
      name: 'lk',
      id: 2,
      uid: 'l',
      type: 'loki',
      jsonData: {},
    } as DataSourceInstanceSettings;

    it.each([
      [
        'handle per-query data source references',
        [
          { refId: 'A', datasource: prometheus },
          { refId: 'B', datasource: loki },
        ],
        ['prometheus', 'loki'],
      ],
      ['handle no per-query data source references', [{ refId: 'A' }, { refId: 'B' }], ['dummy', 'dummy']],
      [
        'handle a mix of query and no-query data source references',
        [{ refId: 'A' }, { refId: 'B', datasource: loki }],
        ['dummy', 'loki'],
      ],
    ])('%s', (_, targets, expectedTypes) => {
      const { ds } = createMockDatasource();

      ds.query({
        maxDataPoints: 10,
        intervalMs: 5000,
        targets,
        range: getDefaultTimeRange(),
      } as DataQueryRequest);

      const { calls } = mockIsQueryServiceCompatible.mock;
      expect(calls).toHaveLength(1);

      const [datasources, compatibilityFlag] = calls[0];
      expect([datasources, compatibilityFlag]).toHaveLength(2);
      expect((datasources as Array<{ type: string }>).map((ds) => ds.type)).toStrictEqual(expectedTypes);
    });
  });
});

function createMockDatasource() {
  const settings = {
    name: 'test',
    id: 1234,
    uid: 'abc',
    type: 'dummy',
    jsonData: {},
  } as DataSourceInstanceSettings<DataSourceJsonData>;

  mockDatasourceRequest.mockReset();
  mockDatasourceRequest.mockReturnValue(Promise.resolve({} as FetchResponse));

  const ds = new MyDataSource(settings);
  return { ds, mock: mockDatasourceRequest.mock };
}
