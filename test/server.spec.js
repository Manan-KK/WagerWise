// ********************** Test Environment Setup **********************************

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test_session_secret';
process.env.POSTGRES_DB = process.env.POSTGRES_DB || 'budgetbites';
process.env.POSTGRES_USER = process.env.POSTGRES_USER || 'postgres';
process.env.POSTGRES_PASSWORD = process.env.POSTGRES_PASSWORD || 'pwd';
process.env.POSTGRES_PORT = process.env.POSTGRES_PORT || '5432';
process.env.POSTGRES_HOST = process.env.POSTGRES_HOST || '127.0.0.1';

// ********************** Import Libraries ***********************************

const chai = require('chai');
const chaiHttp = require('chai-http');
const proxyquire = require('proxyquire');
const sinon = require('sinon');

chai.should();
chai.use(chaiHttp);
const {assert, expect} = chai;

const createDbStub = () => ({
  connect: sinon.stub().callsFake(() => Promise.resolve({ done: () => {} })),
  oneOrNone: sinon.stub().resolves(null),
  none: sinon.stub().resolves(),
  one: sinon.stub().resolves({ recipe_id: 1 }),
  any: sinon.stub().resolves([])
});

const dbStub = createDbStub();
const serverModule = proxyquire('../src/index', {
  'pg-promise': () => () => dbStub
});
const app = serverModule;
const { saveRecipeToDatabase } = serverModule;

const resetDbBehaviors = () => {
  Object.values(dbStub).forEach(stub => {
    if (stub.resetHistory) {
      stub.resetHistory();
    }
  });

  dbStub.oneOrNone.resolves(null);
  dbStub.none.resolves();
  dbStub.one.resolves({ recipe_id: 1 });
  dbStub.any.resolves([]);
};

const buildTestUser = () => ({
  username: 'TestUser',
  email: 'register_test_user@example.com',
  password: 'secret1'
});

beforeEach(resetDbBehaviors);

// ********************** DEFAULT LOGIN PAGE TEST ****************************

describe('Server!', () => {
  it('renders the login page', async () => {
    const res = await chai.request(app).get('/login');

    expect(res).to.have.status(200);
    assert.include(res.text, 'Welcome to BudgetBites');
  });
});

// *********************** REGISTER ROUTE TESTS ******************************

describe('POST /register', () => {
  it('redirects to the login page when a new account is created', async () => {
    const userPayload = buildTestUser();

    const res = await chai
      .request(app)
      .post('/register')
      .type('form')
      .redirects(0)
      .send(userPayload);

    expect(res).to.have.status(302);
    expect(res).to.have.header('location', '/login?registered=1');
    expect(dbStub.oneOrNone.calledOnce).to.be.true;
    expect(dbStub.none.calledOnce).to.be.true;

    const existingUserArgs = dbStub.oneOrNone.getCall(0).args[1];
    expect(existingUserArgs).to.deep.equal([
      userPayload.username.toLowerCase(),
      userPayload.email.toLowerCase()
    ]);

    const insertArgs = dbStub.none.getCall(0).args[1];
    expect(insertArgs[0]).to.equal(userPayload.username.toLowerCase());
    expect(insertArgs[1]).to.equal(userPayload.email.toLowerCase());
    expect(insertArgs[2]).to.not.equal(userPayload.password);
  });

  it('returns a validation error when the username is missing', async () => {
    const res = await chai
      .request(app)
      .post('/register')
      .type('form')
      .send({
        username: '',
        email: 'invalid@example.com',
        password: 'secret1'
      });

    expect(res).to.have.status(200);
    expect(res.text).to.include('Please enter a valid username.');
    expect(dbStub.oneOrNone.called).to.be.false;
    expect(dbStub.none.called).to.be.false;
  });
});

// *********************** SAVE RECIPE TO DATABASE TESTS *********************

describe('saveRecipeToDatabase', () => {
  it('persists the recipe when an id is provided', async () => {
    const recipe = {
      id: 42,
      title: 'Test Recipe',
      summary: 'A budget friendly favorite.',
      servings: 4,
      sourceUrl: 'https://example.com',
      image: 'https://example.com/image.jpg',
      readyInMinutes: 30,
      pricePerServing: 2.75
    };

    const result = await saveRecipeToDatabase(recipe);

    expect(result).to.equal(recipe);
    expect(dbStub.one.calledOnce).to.be.true;

    const insertArgs = dbStub.one.getCall(0).args[1];
    expect(insertArgs[0]).to.equal(recipe.id);
    expect(insertArgs[1]).to.equal(recipe.title);
    expect(insertArgs[2]).to.equal(recipe.summary);
    expect(insertArgs[3]).to.equal(recipe.servings);
    expect(insertArgs[7]).to.equal(recipe.pricePerServing);
    expect(insertArgs[9]).to.equal(JSON.stringify(recipe));
  });

  it('returns null and skips persistence when recipe id is missing', async () => {
    const result = await saveRecipeToDatabase({ title: 'No id recipe' });

    expect(result).to.equal(null);
    expect(dbStub.one.called).to.be.false;
  });
});
