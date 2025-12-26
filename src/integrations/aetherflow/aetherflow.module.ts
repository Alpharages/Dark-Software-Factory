import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AetherFlowClientService } from './aetherflow-client.service';

@Module({
    imports: [HttpModule],
    providers: [AetherFlowClientService],
    exports: [AetherFlowClientService]
})
export class AetherFlowModule { }
