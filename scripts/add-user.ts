import PocketBase from 'pocketbase'

const [email, password, name] = Bun.argv.slice(2)

if (!email || !password) {
  console.error('Usage: bun scripts/add-user.ts <email> <password> [name]')
  process.exit(1)
}

const url = process.env.POCKETBASE_URL ?? 'http://127.0.0.1:8090'
const adminEmail = process.env.POCKETBASE_ADMIN_EMAIL
const adminPassword = process.env.POCKETBASE_ADMIN_PASSWORD

if (!adminEmail || !adminPassword) {
  console.error('POCKETBASE_ADMIN_EMAIL and POCKETBASE_ADMIN_PASSWORD are required')
  process.exit(1)
}

const pb = new PocketBase(url)
await pb.collection('_superusers').authWithPassword(adminEmail, adminPassword)

await pb.collection('users').create({
  email,
  password,
  passwordConfirm: password,
  name: name ?? email.split('@')[0],
  verified: true,
  emailVisibility: true,
})

console.log(`User created: ${email}`)
