// ********************** Test Environment Setup **********************************

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test_session_secret';
process.env.POSTGRES_DB = process.env.POSTGRES_DB || 'budgetbites';
process.env.POSTGRES_USER = process.env.POSTGRES_USER || 'postgres';
process.env.POSTGRES_PASSWORD = process.env.POSTGRES_PASSWORD || 'pwd';
process.env.POSTGRES_PORT = process.env.POSTGRES_PORT || '5432';
process.env.POSTGRES_HOST = process.env.POSTGRES_HOST || '127.0.0.1';

// ********************** Import Libraries ***********************************

const chai = require('chai'); // Chai HTTP provides an interface for live integration testing of the API's.
const chaiHttp = require('chai-http');
const pgp = require('pg-promise')();
const cleanupDb = pgp({
  host: process.env.POSTGRES_HOST || 'db',
  port: Number(process.env.POSTGRES_PORT) || 5432,
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD
});

chai.should();
chai.use(chaiHttp);
const {assert, expect} = chai;

const server = require('../src/index');

const TEST_EMAIL = 'register_test_user@example.com';

const buildTestUser = () => {
  const uniqueSuffix = `${Date.now()}${Math.round(Math.random() * 1000)}`;
  return {
    username: `testuser_${uniqueSuffix}`,
    email: TEST_EMAIL,
    password: 'secret1'
  };
};

const deleteUser = async ({ username, email }) => {
  await cleanupDb.none('DELETE FROM users WHERE username = $1 OR email = $2', [
    username,
    email || null
  ]);
};

// ********************** DEFAULT LOGIN PAGE TEST ****************************

describe('Server!', () => {
  it('renders the login page', done => {
    chai
      .request(server)
      .get('/login')
      .end((err, res) => {
        expect(res).to.have.status(200);
        assert.include(res.text, 'Welcome to BudgetBites');
        done();
      });
  });
});

// *********************** REGISTER ROUTE TESTS ******************************

describe('POST /register', () => {
  beforeEach(async () => {
    await deleteUser({ username: '', email: TEST_EMAIL });
  });

  it('redirects to the login page when a new account is created', async () => {
    const userPayload = buildTestUser();
    const res = await chai
      .request(server)
      .post('/register')
      .type('form')
      .redirects(0)
      .send(userPayload);

    expect(res).to.have.status(302);
    expect(res).to.have.header('location', '/login?registered=1');

    await deleteUser(userPayload);
  });

  it('returns a validation error when the username is missing', async () => {
    const res = await chai
      .request(server)
      .post('/register')
      .type('form')
      .send({
        username: '',
        email: 'invalid@example.com',
        password: 'secret1'
      });

    expect(res).to.have.status(200);
    expect(res.text).to.include('Please enter a valid username.');
  });
});

after(() => {
  pgp.end();
});
