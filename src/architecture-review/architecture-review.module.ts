import { Module } from '@nestjs/common';
import { AdrService } from './adr.service';
import { DatabaseModule } from '../database/database.module';

@Module({
    imports: [DatabaseModule],
    providers: [AdrService],
    exports: [AdrService],
})
export class ArchitectureReviewModule { }
