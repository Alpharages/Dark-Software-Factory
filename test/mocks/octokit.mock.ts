export class Octokit {
  constructor(_options: unknown) {
    // Mock constructor
  }

  public request = jest.fn();
  public repos = {
    get: jest.fn(),
  };
  public git = {
    createRef: jest.fn(),
  };
  public pulls = {
    create: jest.fn(),
  };
  public issues = {
    createComment: jest.fn(),
  };
}
