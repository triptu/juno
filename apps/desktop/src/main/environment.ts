import { app } from 'electron'
import { gateTestEnvironment } from './testEnvironment'

gateTestEnvironment({ isPackaged: app.isPackaged, defaultUserData: app.getPath('userData'), env: process.env })
